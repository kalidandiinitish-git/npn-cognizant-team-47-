-- =====================================================================
-- FraudStream AI - explainable investigation workbench
--
-- The ML engine remains the only writer (through the service-role key).
-- Authenticated browser users can read cases and notes; all workflow
-- mutations go through the authenticated FastAPI endpoints.
-- =====================================================================

-- Alert and case rows are queued independently by the background writer, so
-- this link deliberately has no foreign key: an alert can be inserted before
-- its case in the same flush.
alter table public.fraud_alerts
  add column if not exists case_id uuid;

create unique index if not exists fraud_alerts_case_id_idx
  on public.fraud_alerts (case_id)
  where case_id is not null;

-- ---------------------------------------------------------------------
-- investigation_cases: current case state plus immutable evidence snapshot
-- ---------------------------------------------------------------------
create table if not exists public.investigation_cases (
  id                    uuid primary key,
  case_number           text not null unique,
  alert_id              uuid not null unique,
  transaction_id        text not null,
  account_id            text not null,
  risk_score            numeric(9, 6) not null
                          check (risk_score >= 0 and risk_score <= 1),
  risk_level            text not null
                          check (risk_level in ('high', 'critical')),
  alert_type            text not null,
  priority              text not null default 'high'
                          check (priority in ('low', 'medium', 'high', 'urgent')),
  status                text not null default 'open'
                          check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  assignee_id           text,
  assignee_email        text,
  transaction_snapshot  jsonb not null default '{}'::jsonb,
  alert_snapshot        jsonb not null default '{}'::jsonb,
  explanation           jsonb not null default '{}'::jsonb,
  reason_codes          jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(reason_codes) = 'array'),
  resolution_code       text
                          check (
                            resolution_code is null or resolution_code in (
                              'confirmed_fraud',
                              'legitimate',
                              'false_positive',
                              'duplicate',
                              'insufficient_evidence',
                              'other'
                            )
                          ),
  resolution_summary    text,
  analyst_confidence    numeric(5, 4)
                          check (
                            analyst_confidence is null or
                            (analyst_confidence >= 0 and analyst_confidence <= 1)
                          ),
  resolved_by           text,
  resolved_at           timestamptz,
  version               integer not null default 1 check (version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.investigation_cases is
  'Explainable fraud cases opened from live alerts and managed through FastAPI.';
comment on column public.investigation_cases.explanation is
  'Native model contribution explanation; output space and availability are recorded in the payload.';
comment on column public.investigation_cases.reason_codes is
  'Human-readable model, behavior, and account evidence supporting the alert.';
comment on column public.investigation_cases.version is
  'Optimistic concurrency version incremented by every case mutation.';

create index if not exists investigation_cases_created_at_idx
  on public.investigation_cases (created_at desc);
create index if not exists investigation_cases_status_idx
  on public.investigation_cases (status, updated_at desc);
create index if not exists investigation_cases_priority_idx
  on public.investigation_cases (priority, created_at desc);
create index if not exists investigation_cases_assignee_idx
  on public.investigation_cases (assignee_id, status);
create index if not exists investigation_cases_account_idx
  on public.investigation_cases (account_id, created_at desc);
create index if not exists investigation_cases_transaction_idx
  on public.investigation_cases (transaction_id);

-- ---------------------------------------------------------------------
-- investigation_notes: append-only analyst collaboration history
-- ---------------------------------------------------------------------
create table if not exists public.investigation_notes (
  id            uuid primary key,
  case_id       uuid not null references public.investigation_cases (id) on delete cascade,
  author_id     text not null,
  author_email  text,
  body          text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at    timestamptz not null default now()
);

comment on table public.investigation_notes is
  'Append-only notes created by analysts through the investigation API.';

create index if not exists investigation_notes_case_idx
  on public.investigation_notes (case_id, created_at);
create index if not exists investigation_notes_author_idx
  on public.investigation_notes (author_id, created_at desc);

-- Keep case updated_at aligned with persisted workflow mutations.
drop trigger if exists investigation_cases_touch_updated_at
  on public.investigation_cases;
create trigger investigation_cases_touch_updated_at
  before update on public.investigation_cases
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------
alter table public.investigation_cases enable row level security;
alter table public.investigation_notes enable row level security;

-- Detection evidence is visible to signed-in console users. Mutations are
-- intentionally absent: the browser must use FastAPI, which verifies identity,
-- validates transitions, applies optimistic concurrency, and records actors.
drop policy if exists "investigation_cases_read_authenticated"
  on public.investigation_cases;
create policy "investigation_cases_read_authenticated"
  on public.investigation_cases for select
  to authenticated
  using (true);

drop policy if exists "investigation_notes_read_authenticated"
  on public.investigation_notes;
create policy "investigation_notes_read_authenticated"
  on public.investigation_notes for select
  to authenticated
  using (true);

revoke all on public.investigation_cases from anon, authenticated;
revoke all on public.investigation_notes from anon, authenticated;
grant select on public.investigation_cases to authenticated;
grant select on public.investigation_notes to authenticated;

-- Explicit service-role grants document the intended writer even though the
-- role also bypasses RLS in hosted Supabase.
grant all on public.investigation_cases to service_role;
grant all on public.investigation_notes to service_role;

-- fraud_alerts.case_id is written only by the engine. Existing authenticated
-- alert triage remains limited to the status column by migration 0001.
revoke update (case_id) on public.fraud_alerts from anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  target text;
begin
  foreach target in array array['investigation_cases', 'investigation_notes']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        target
      );
    end if;
  end loop;
end
$$;

alter table public.investigation_cases replica identity full;
alter table public.investigation_notes replica identity full;
