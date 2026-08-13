# API reference

Base URL: `http://localhost:8000` in development. All routes are namespaced under
`/api`. Interactive docs are served at `/docs`.

## Authentication

Every route except `/api/health` requires the caller's Supabase access token:

```
Authorization: Bearer <supabase access token>
```

The service verifies the token against `GET {SUPABASE_URL}/auth/v1/user` and
caches the result for 60 seconds. Behaviour depends on configuration:

| `REQUIRE_AUTH` | Supabase configured | Result |
| --- | --- | --- |
| `true` | yes | Tokens are verified; invalid or missing tokens get 401 |
| `true` | no | Requests are allowed and a warning is logged (cannot verify) |
| `false` | either | Auth disabled - local development only |

The service-role key is never used for request authentication; it is only used by
the writer thread to insert rows.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Bad stream source or unusable request |
| 401 | Missing, malformed or expired session token |
| 404 | Unknown alert or account |
| 409 | A stream is already running |
| 413 | Upload exceeds 250 MB |
| 422 | Request body failed validation |
| 503 | Model artifacts missing, or Supabase Auth unreachable |

Error bodies are `{"detail": "..."}`.

---

## System

### `GET /api/health`

Public. Readiness summary.

```json
{
  "status": "ok",
  "version": "1.0.0",
  "model_loaded": true,
  "model_name": "xgboost",
  "dataset_available": true,
  "stream_source_available": true,
  "supabase_configured": false,
  "auth_required": false,
  "detail": null,
  "engine_uptime_seconds": 42.1
}
```

`status` is `degraded` when no model is loaded.

---

## Detection

### `POST /api/predict`

Scores one transaction. Send `Time`, `Amount` and as many of `V1`..`V28` as you
have; missing components default to 0 and the response reports completeness.

```json
{ "Time": 3600, "Amount": 149.62, "V1": -1.359, "V2": -0.072, "V3": 2.536 }
```

Response:

```json
{
  "transaction_ref": "TXN-API-9F2C1A0B4D",
  "transaction_time": "2025-01-06T01:00:00+00:00",
  "transaction_amount": 149.62,
  "account_id": "ACC-00218",
  "card_last4": "4417",
  "merchant": "VoltZone",
  "merchant_category": "Electronics",
  "location": "Berlin, DE",
  "channel": "ecommerce",
  "model_score": 0.0231,
  "risk_score": 0.0878,
  "risk_level": "low",
  "decision": "Allow",
  "is_fraud": false,
  "inference_latency_ms": 0.913,
  "threshold": 0.1842,
  "model_name": "xgboost",
  "model_version": "1.0.0",
  "latency_target_ms": 50.0,
  "feature_completeness": { "provided": 3, "expected": 28 }
}
```

Set `"update_account_risk": true` to also fold the transaction into the account
profile. Off by default so ad-hoc scoring does not distort stream statistics.

---

## Stream control

### `POST /api/stream/start`

Returns `409 Conflict` when a stream is already running. Stop it first, or use
the dashboard's "Restart with these settings", which stops then starts.

```json
{ "source": null, "limit": 2000, "delay_ms": 120, "skip": 0, "persist": true, "reset": true }
```

| Field | Default | Notes |
| --- | --- | --- |
| `source` | held-out split | Bare `.csv` file name, looked up in `ml-engine/data` then `ml-engine/data/uploads` |
| `limit` | `STREAM_MAX_TRANSACTIONS` | Capped by the same setting |
| `delay_ms` | `STREAM_DELAY_MS` | 0 runs as fast as the machine allows |
| `skip` | 0 | Leading rows to ignore |
| `persist` | `true` | Write to Supabase |
| `reset` | `true` | Clear counters and account state first |

Returns `{"started": true, ...status}` on success, or `409` with a reason when a
stream is already active.

`source` is deliberately restricted to a bare file name: directory components,
`..` and absolute paths are rejected with `422`, so a request cannot stream an
arbitrary file off the host. Point `DATA_PATH` or `STREAM_DATA_PATH` at anything
outside the data directory instead.

### `POST /api/stream/stop`

Signals the generator, waits up to 5 seconds for the loop to finish the current
transaction, and returns the final status. Safe to call when idle.

### `GET /api/stream/status`

```json
{
  "status": "running",
  "config": { "source": "...stream_test.csv", "limit": 2000, "delay_ms": 120, "skip": 0, "persist": true },
  "processed": 412,
  "invalid_records": 0,
  "alerts_raised": 7,
  "persisted": 0,
  "persist_failures": 0,
  "started_at": "2026-08-13T09:14:02+00:00",
  "finished_at": null,
  "elapsed_seconds": 51.3,
  "transactions_per_second": 8.03,
  "error": null,
  "is_running": true,
  "source_total_rows": 42560
}
```

`status` is one of `idle`, `running`, `stopping`, `completed`, `error`.

---

## Dashboard data

### `GET /api/metrics`

One call for every widget. Top-level keys:

| Key | Contents |
| --- | --- |
| `stream` | The status payload above |
| `totals` | Transactions, flagged count, detection rate, critical alerts, high-risk accounts, throughput |
| `latency` | average, median, p95, p99, max, target, `within_target`, sample size |
| `risk_distribution` | Count and share per band, with the action |
| `account_risk_levels` | Account counts per band |
| `live_quality` | TP/FP/TN/FN plus precision, recall, F1, FPR from streamed labels |
| `timeline` | Per-second buckets: transactions, flagged, average latency |
| `model` | Name, version, threshold, trained-at, metrics |
| `persistence` | Writer queue depth, successes, failures |

### `GET /api/transactions/recent`

Query: `limit` (1-500, default 50), `risk_level`.

### `GET /api/alerts`

Query: `limit` (1-500), `risk_level` (`high` or `critical`).

### `PATCH /api/alerts/{transaction_id}`

Body: `{"status": "open" | "investigating" | "resolved" | "dismissed"}`. Updates the
live buffer and the Supabase row. 404 when the alert has aged out of the buffer.

### `GET /api/accounts/high-risk`

Query: `minimum_level` (default `high`), `limit` (1-200).

```json
{
  "count": 1,
  "accounts": [
    {
      "account_id": "ACC-00312",
      "transaction_count": 6,
      "suspicious_count": 4,
      "average_risk_score": 0.612,
      "maximum_risk_score": 0.973,
      "risk_score": 0.94,
      "risk_level": "critical",
      "last_activity": "2025-01-07T22:41:10+00:00",
      "signals": {
        "average_risk": 0.61,
        "maximum_risk": 0.97,
        "suspicious_ratio": 0.67,
        "velocity": 1.0,
        "high_value_ratio": 0.83,
        "geo_anomaly": 1.0,
        "merchant_anomaly": 1.0
      }
    }
  ]
}
```

### `GET /api/accounts/{account_id}`

Adds the account's recent transactions to the payload above.

---

## Model and dataset

### `GET /api/model`

Returns `model_metadata.json` plus a `live_quality` block: threshold and tuning
strategy, validation and test metrics, the precision-recall curve, the candidate
comparison table, measured latency, dataset profile, risk bands and the leakage
check result.

### `GET /api/dataset/info`

Active training file, stream source with row count, stored uploads, the EDA
profile (cleaning report, class distribution, amount statistics, hourly
distribution, top absolute correlations, split sizes) and a `fraud_index` block:

```json
{
  "fraud_index": {
    "source": "stream_test.csv",
    "total_rows": 42560,
    "fraud_count": 52,
    "fraud_rate": 0.001222,
    "first_fraud_row": 1326,
    "recommended_skip": 1311,
    "densest_window": { "start": 9763, "end": 10163, "fraud_count": 5, "window_size": 400 }
  }
}
```

Labelled fraud is 0.12 % of the split, so a replay from row one shows several
minutes of clean traffic before anything is flagged. Pass `recommended_skip` or
`densest_window.start` as `skip` on `/api/stream/start` to begin near labelled
fraud. Only the starting offset changes; the order of events is untouched.
Regenerate the index with `python -m src.streaming.index`.

### `POST /api/dataset/upload`

`multipart/form-data` with a `file` field. Accepts `.csv` up to 250 MB. File names
are restricted to letters, digits, dot, underscore and hyphen; the path component
is stripped. Files land in `ml-engine/data/uploads` and can be streamed by passing
the stored name as `source` on `/api/stream/start`, which searches `data/` and
then `data/uploads/`.
