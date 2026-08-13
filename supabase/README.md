# Supabase setup

## Apply the schema

Either paste `migrations/0001_init.sql` into the SQL editor, or use the CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

The migration is idempotent, so re-running it is safe.

## What it creates

| Table | Purpose | Written by |
| --- | --- | --- |
| `profiles` | Application users, linked to `auth.users` | `on_auth_user_created` trigger |
| `transactions` | Every scored transaction | Engine (service role) |
| `fraud_alerts` | Transactions at or above risk 0.70 | Engine (service role) |
| `account_risk` | Rolling account risk, upserted on `account_id` | Engine (service role) |
| `model_metrics` | One row per training run | Training script |

## Security model

Row Level Security is on for all five tables.

| Role | Can read | Can write |
| --- | --- | --- |
| `anon` | nothing | nothing |
| `authenticated` | all detection tables, own profile | `fraud_alerts.status`, own profile |
| `service_role` | everything | everything (bypasses RLS) |

Two details worth knowing:

- RLS cannot restrict columns, so alert triage is narrowed with
  `grant update (status) on public.fraud_alerts to authenticated`. An analyst
  cannot rewrite a risk score even though the update policy allows the row.
- Insert, update and delete are revoked from `anon` and `authenticated` on the
  detection tables. Only the engine writes, using the service-role key that lives
  in `ml-engine/.env`.

## Realtime

`transactions`, `fraud_alerts` and `account_risk` are added to the
`supabase_realtime` publication with `replica identity full`, so update payloads
carry the whole row. The dashboard subscribes to inserts on the first two and all
changes on the third.

Realtime respects RLS: a subscriber only receives rows it could select.

## Seed data

`seed/seed.sql` inserts a small, clearly fictional set of transactions, alerts and
accounts so the dashboard is not empty before the first stream run. Delete it
before any real use:

```sql
delete from public.fraud_alerts where transaction_id like 'TXN-SEED-%';
delete from public.transactions where transaction_ref like 'TXN-SEED-%';
delete from public.account_risk where account_id like 'ACC-SEED-%';
delete from public.model_metrics where model_name = 'seed_example';
```

## Authentication

Email and password is enough for this project. The trigger creates a `profiles`
row on sign-up, defaulting the role to `analyst`. To promote someone:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

For a live demo, disable email confirmation under Authentication, Providers,
Email so accounts work immediately.

## Edge functions

`functions/` is a placeholder. Nothing in the current design needs one: the Python
engine owns scoring and persistence. See `functions/README.md` for the cases where
one would earn its place.
