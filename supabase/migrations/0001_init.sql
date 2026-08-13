-- =====================================================================
-- FraudStream AI - database schema
-- PRD reference: supabase_database.tables + supabase_database.security
--
-- Apply with either:
--   supabase db push
-- or by pasting this file into the Supabase SQL editor.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles: one row per application user, linked to Supabase Auth
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'analyst'
                check (role in ('analyst', 'admin', 'developer', 'viewer')),
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Application users. Populated by the on_auth_user_created trigger.';

-- ---------------------------------------------------------------------
-- transactions: every streamed transaction with its prediction
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id                      uuid primary key default gen_random_uuid(),
  transaction_ref         text unique,
  sequence                integer,
  account_id              text not null,
  card_last4              text,
  transaction_amount      numeric(14, 2) not null check (transaction_amount >= 0),
  merchant                text,
  merchant_category       text,
  location                text,
  channel                 text,
  transaction_time        timestamptz not null,
  model_score             numeric(9, 6) not null check (model_score >= 0 and model_score <= 1),
  risk_score              numeric(9, 6) not null check (risk_score >= 0 and risk_score <= 1),
  risk_level              text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  decision                text,
  is_fraud                boolean not null default false,
  inference_latency_ms    numeric(10, 3),
  processing_latency_ms   numeric(10, 3),
  actual_label            smallint,
  account_risk_level      text,
  behaviour               jsonb,
  created_at              timestamptz not null default now()
);

comment on column public.transactions.model_score is 'Raw model probability of fraud.';
comment on column public.transactions.risk_score is 'Probability rescaled onto the PRD risk bands.';
comment on column public.transactions.is_fraud is 'System decision, not ground truth.';
comment on column public.transactions.actual_label is 'Dataset label, kept only for offline evaluation.';

create index if not exists transactions_created_at_idx on public.transactions (created_at desc);
create index if not exists transactions_account_idx on public.transactions (account_id);
create index if not exists transactions_risk_level_idx on public.transactions (risk_level);
create index if not exists transactions_is_fraud_idx on public.transactions (is_fraud) where is_fraud;

-- ---------------------------------------------------------------------
-- fraud_alerts: raised when a transaction reaches the alert threshold
-- ---------------------------------------------------------------------
create table if not exists public.fraud_alerts (
  id                  uuid primary key default gen_random_uuid(),
  transaction_id      text not null,
  account_id          text not null,
  risk_score          numeric(9, 6) not null,
  risk_level          text not null check (risk_level in ('high', 'critical')),
  alert_type          text not null,
  status              text not null default 'open'
                        check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  merchant            text,
  transaction_amount  numeric(14, 2),
  location            text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- transaction_id holds transactions.transaction_ref. It is intentionally not a
-- foreign key: alerts and transactions are written in independent batches, so a
-- hard constraint would make write ordering matter.
comment on column public.fraud_alerts.transaction_id is
  'Matches transactions.transaction_ref.';

create index if not exists fraud_alerts_created_at_idx on public.fraud_alerts (created_at desc);
create index if not exists fraud_alerts_status_idx on public.fraud_alerts (status);
create index if not exists fraud_alerts_account_idx on public.fraud_alerts (account_id);
create index if not exists fraud_alerts_transaction_idx on public.fraud_alerts (transaction_id);

-- ---------------------------------------------------------------------
-- account_risk: rolling account level risk, upserted by the engine
-- ---------------------------------------------------------------------
create table if not exists public.account_risk (
  account_id          text primary key,
  transaction_count   integer not null default 0,
  suspicious_count    integer not null default 0,
  average_risk_score  numeric(9, 6) not null default 0,
  maximum_risk_score  numeric(9, 6) not null default 0,
  risk_score          numeric(9, 6) not null default 0,
  risk_level          text not null default 'low'
                        check (risk_level in ('low', 'medium', 'high', 'critical')),
  last_activity       timestamptz,
  updated_at          timestamptz not null default now()
);

create index if not exists account_risk_score_idx on public.account_risk (risk_score desc);
create index if not exists account_risk_level_idx on public.account_risk (risk_level);

-- ---------------------------------------------------------------------
-- model_metrics: one row per training/evaluation run
-- ---------------------------------------------------------------------
create table if not exists public.model_metrics (
  id                  uuid primary key default gen_random_uuid(),
  model_name          text not null,
  version             text not null,
  "precision"         numeric(9, 6),
  recall              numeric(9, 6),
  f1_score            numeric(9, 6),
  pr_auc              numeric(9, 6),
  roc_auc             numeric(9, 6),
  average_latency_ms  numeric(10, 3),
  threshold           numeric(9, 6),
  created_at          timestamptz not null default now()
);

create index if not exists model_metrics_created_at_idx on public.model_metrics (created_at desc);

-- ---------------------------------------------------------------------
-- Keep updated_at honest on alerts
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fraud_alerts_touch_updated_at on public.fraud_alerts;
create trigger fraud_alerts_touch_updated_at
  before update on public.fraud_alerts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Create a profile row whenever a user signs up
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Row Level Security (PRD supabase_database.security)
--
-- Rules implemented:
--   * Authenticated users can read dashboard data.
--   * Nobody writes detection data through the anon/authenticated roles -
--     only the ML engine, which uses the service-role key and bypasses RLS.
--   * Analysts may triage alerts, but only the status column.
--   * A user can read and update only their own profile.
-- =====================================================================

alter table public.profiles     enable row level security;
alter table public.transactions enable row level security;
alter table public.fraud_alerts enable row level security;
alter table public.account_risk enable row level security;
alter table public.model_metrics enable row level security;

-- profiles ------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- transactions --------------------------------------------------------
drop policy if exists "transactions_read_authenticated" on public.transactions;
create policy "transactions_read_authenticated"
  on public.transactions for select
  to authenticated
  using (true);

-- fraud_alerts --------------------------------------------------------
drop policy if exists "fraud_alerts_read_authenticated" on public.fraud_alerts;
create policy "fraud_alerts_read_authenticated"
  on public.fraud_alerts for select
  to authenticated
  using (true);

drop policy if exists "fraud_alerts_triage" on public.fraud_alerts;
create policy "fraud_alerts_triage"
  on public.fraud_alerts for update
  to authenticated
  using (true)
  with check (true);

-- account_risk --------------------------------------------------------
drop policy if exists "account_risk_read_authenticated" on public.account_risk;
create policy "account_risk_read_authenticated"
  on public.account_risk for select
  to authenticated
  using (true);

-- model_metrics -------------------------------------------------------
drop policy if exists "model_metrics_read_authenticated" on public.model_metrics;
create policy "model_metrics_read_authenticated"
  on public.model_metrics for select
  to authenticated
  using (true);

-- Column level privileges: RLS cannot restrict columns, so alert triage is
-- narrowed to the status column with a grant.
revoke update on public.fraud_alerts from authenticated;
grant update (status) on public.fraud_alerts to authenticated;

-- No write privileges at all for the browser roles on detection tables.
revoke insert, update, delete on public.transactions from anon, authenticated;
revoke insert, delete on public.fraud_alerts from anon, authenticated;
revoke insert, update, delete on public.account_risk from anon, authenticated;
revoke insert, update, delete on public.model_metrics from anon, authenticated;

-- =====================================================================
-- Realtime (PRD FR-013 / PR-003)
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Adding a table twice raises an error, so each one is checked first. This
-- keeps the migration safe to re-run.
do $$
declare
  target text;
begin
  foreach target in array array['transactions', 'fraud_alerts', 'account_risk']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end
$$;

-- Realtime payloads need the full row for updates.
alter table public.transactions replica identity full;
alter table public.fraud_alerts replica identity full;
alter table public.account_risk replica identity full;
