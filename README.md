# FraudStream AI

Real-time pseudo-streaming credit card fraud detection. Transactions are replayed
through a Python generator one at a time, scored in under a millisecond, mapped
onto risk bands, aggregated into account-level risk, stored in Supabase and shown
live in a React dashboard.

Built against the requirements in `docs/PRD.json`.

---

## What it actually does

1. Trains and compares four detectors on `creditcard.csv` using a chronological split.
2. Tunes the decision threshold on a precision-recall curve instead of leaving it at 0.5.
3. Replays the untouched final 15 % of the timeline as an event stream, one transaction per iteration.
4. Scores each transaction, assigns a risk band, updates the account profile and raises alerts.
5. Persists everything to Supabase Postgres and pushes it to the dashboard over Supabase Realtime.

### Measured results from the last full run

| Metric | Value |
| --- | --- |
| Selected model | XGBoost (`scale_pos_weight` for imbalance) |
| Decision threshold | 0.1842 (max F2 with precision floor 0.50) |
| Test PR-AUC | 0.7629 |
| Test ROC-AUC | 0.9737 |
| Test precision / recall / F1 | 0.750 / 0.750 / 0.750 |
| False positive rate | 0.0003 (13 in 42,508 legitimate) |
| Average inference latency | 0.97 ms |
| p95 / p99 latency | 1.59 ms / 1.93 ms (budget 50 ms) |

Dataset after cleaning: 283,726 transactions, 473 frauds (0.1667 %), imbalance 1:599,
1,081 duplicate rows removed. Full report in `ml-engine/models/model_metadata.json`
and `docs/model-card.md`.

---

## Repository layout

```
fraudstream-ai/
  frontend/          React 16 + Vite + Tailwind + Recharts dashboard
  ml-engine/         Python: preprocessing, training, generator, risk engine, FastAPI
  supabase/          Schema migration, RLS policies, realtime setup, seed data
  docs/              PRD, architecture, API reference, model card, deployment guide
  tools/             PowerShell helpers for training, tests and frontend builds
```

---

## Quick start

### 0. Prerequisites

- Python 3.10+
- Node 18+
- `creditcard.csv` (Time, V1..V28, Amount, Class). The engine looks in
  `ml-engine/data/`, then the repository parent folder, or wherever `DATA_PATH` points.

### 1. ML engine

```powershell
cd ml-engine
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env          # fill in Supabase values when you have them

# Train, compare candidates, tune the threshold, write artifacts
.\.venv\Scripts\python.exe -m src.training.train

# Serve the detection engine
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000
```

Training writes:

- `models/fraud_model.joblib`, `models/preprocessor.joblib`, `models/model_metadata.json`
- `data/stream_test.csv` - the held-out split the generator replays
- `data/dataset_profile.json` - the EDA summary the dashboard reads

Use `--fast` for a quick pass, `--max-rows N` to cap input, `--smote` to oversample.

### 2. Supabase

Run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push`).
It creates the five tables, enables RLS, wires the auth trigger and adds the
detection tables to the realtime publication. Details in `supabase/README.md`.

### 3. Frontend

```powershell
cd frontend
npm install
copy .env.example .env.local    # add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
npm run dev                     # http://localhost:5173
```

### 4. Tests

```powershell
cd ml-engine
.\.venv\Scripts\python.exe -m pytest
```

53 tests cover the generator contract, risk bands, account aggregation, feature
parity between the training and serving paths, latency against the 50 ms budget,
and the API surface.

---

## Security notes

- The `SUPABASE_SERVICE_ROLE_KEY` lives only in `ml-engine/.env`. It is never
  referenced by frontend code.
- The browser gets the anon key, and every detection table is read-only to the
  `authenticated` role. Only the status column on `fraud_alerts` is writable, via
  a column-level grant.
- The FastAPI service verifies the caller's Supabase access token on every route
  except `/api/health`. With `REQUIRE_AUTH=true` and Supabase configured, an
  unauthenticated request is rejected.
- `VITE_DEMO_MODE` bypasses login for local development only. It is off by
  default and must stay off anywhere reachable from the internet.
- CORS is restricted to the origins listed in `CORS_ORIGINS`.

---

## Demo script

1. Sign in.
2. Open the overview - the stream is idle, counters at zero.
3. Open **Stream** settings in the top bar and pick a start position. Fraud is
   0.12 % of the held-out split, so "At the first labelled fraud" or "Fraud-dense
   window" gets to the interesting part without waiting. Order of events is
   unchanged; only the starting row differs.
4. Press **Start stream**. Transactions arrive one per 120 ms.
5. Watch the live monitor: risk score, band, latency and event time per row.
6. A high-scoring transaction appears and an alert shows up in the alerts panel.
7. The same account collects more hits and escalates to critical on the accounts
   page; expand it to see the seven weighted signals.
8. Open model analytics: PR curve, confusion matrix, candidate comparison, tuned threshold.
9. Open dataset and stream: class imbalance, cleaning report, hourly distribution.

To verify the whole path without a browser:

```powershell
cd ml-engine
.\.venv\Scripts\python.exe scripts\smoke_e2e.py
```

It spawns the server, streams 400 transactions from the indexed fraud window and
checks 23 assertions across every endpoint, including that alerts fire and
accounts escalate.

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md) - components and data flow
- [`docs/api.md`](docs/api.md) - endpoint reference
- [`docs/model-card.md`](docs/model-card.md) - training, metrics, limitations
- [`docs/deployment.md`](docs/deployment.md) - Vercel, Render, Supabase
- [`docs/PRD.json`](docs/PRD.json) - the source requirements
