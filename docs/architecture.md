# Architecture

## Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| Frontend | React 16, Vite, Tailwind, Recharts | Landing page and authenticated console |
| Detection engine | Python 3.10+, FastAPI, Uvicorn | Training, streaming, scoring, risk aggregation, API |
| Database | Supabase Postgres | Durable transactions, alerts, account risk, model metrics |
| Auth | Supabase Auth | Sessions for the dashboard; token verification for the API |
| Realtime | Supabase Realtime | Pushes inserts to the browser |

## Data flow

```
creditcard.csv
      |
      v
[ clean + de-duplicate ]        rows_in 284,807 -> rows_out 283,726
      |
      v
[ feature engineering ]         V1..V28 + amount, log_amount, seconds_of_day,
      |                          hour_of_day, is_night
      v
[ time-aware split 70/15/15 ]   train 198,608 | validation 42,558 | test 42,560
      |                                                     |
      v                                                     v
[ train 4 candidates ]                            data/stream_test.csv
[ tune threshold on validation ]                            |
[ select on PR-AUC + latency ]                              |
      |                                                     |
      v                                                     v
models/{fraud_model,preprocessor}.joblib          [ Python generator ]
models/model_metadata.json                                  |
      |                                                     v
      +----------------------------------------> [ FraudPredictor.predict ]
                                                            |
                                          probability -> risk score -> band
                                                            |
                                        +-------------------+-------------------+
                                        v                                       v
                              [ AccountRiskEngine ]                    [ in-memory buffers ]
                                        |                                       |
                                        v                                       v
                              [ SupabaseWriter (async) ]              GET /api/metrics
                                        |
                                        v
                              Supabase Postgres --> Realtime --> React dashboard
```

## The streaming loop

`ml-engine/src/streaming/processor.py` runs one iteration per transaction:

1. `transaction_stream` yields a single `TransactionEvent` (csv.DictReader, never a DataFrame).
2. `validate_record` rejects malformed rows; the stream counts them and continues.
3. `FraudPredictor.predict` transforms features and runs inference, timing only that work.
4. `assess` maps the probability to a risk score, band and action.
5. `AccountRiskEngine.behavioural_features` reads the account's prior state, then `update` folds the new transaction in.
6. The scored row goes into in-memory ring buffers and is queued for Supabase.
7. Persistence happens on a separate thread, so network latency never counts against the 50 ms budget.

### Why a generator rather than a batch

A DataFrame over the test split would hold every row in memory and predict in one
vectorised call. That is a batch job, and it makes three things impossible:

- Measuring latency for an individual transaction.
- Stopping cleanly part-way through, which the dashboard's stop button needs.
- Bounding memory as the input grows.

`tests/test_generator.py::test_no_batch_read_happens` asserts the laziness by
counting parse calls: consuming three events must parse exactly three rows.

## Threading model

| Thread | Purpose |
| --- | --- |
| Uvicorn workers | Serve HTTP requests |
| `pseudo-stream` | Runs the generator loop; one per process, guarded by a lock |
| `supabase-writer` | Drains a bounded queue and writes batches |

The stream thread is the only writer of stream state; `StreamState` still guards
its counters with a re-entrant lock because the API reads them concurrently. The
account risk engine is touched only by the stream thread.

## Latency budget

Target: under 50 ms per transaction (PR-001). Measured on the selected model:

| Stage | Cost |
| --- | --- |
| Feature vector construction | ~0.05 ms |
| Preprocessor transform (impute + scale) | ~0.15 ms |
| XGBoost inference | ~0.75 ms |
| Total measured average | 0.97 ms |
| p95 / p99 | 1.59 ms / 1.93 ms |

Persistence, realtime fan-out and the dashboard poll are all outside this budget
by design. Model selection enforces a 2x headroom rule: a candidate whose p95
exceeds 25 ms is not chosen even if its PR-AUC is higher, which is why the
random forest (p95 ~33 ms, PR-AUC 0.87) loses to XGBoost (p95 1.6 ms, PR-AUC 0.85).

## Derived identity attributes

The ULB dataset is anonymised: 28 PCA components, elapsed seconds, amount, label.
There is no account, merchant or location. Account-level risk (FR-011) needs a
stable grouping key, so `features/identity.py` derives one from a blake2b hash of
quantised PCA values. Consequences:

- The mapping is deterministic and reproducible across machines and runs.
- Rows with similar PCA signatures share an account, so suspicious behaviour
  concentrates, which is what makes escalation observable.
- These attributes are never model inputs. `config.MODEL_FEATURES` excludes them
  and `tests/test_features.py` enforces it, so they cannot leak signal.

## Reliability

| Failure | Behaviour |
| --- | --- |
| Malformed CSV row | Logged, counted in `invalid_records`, stream continues |
| Model artifacts missing | API returns 503 with the training command; no fake scores |
| Supabase unreachable | Writer logs, counts failures, keeps serving from memory |
| Supabase not configured | Writer becomes a no-op; dashboard falls back to polling |
| Realtime channel drops | Dashboard shows "Realtime retrying" and keeps polling |
| Stop requested | Generator checks a callback before each event and returns cleanly |

## Path to real streaming

`transaction_stream` is the only component that knows where events come from.
Replacing it with a Kafka or Redis Streams consumer that yields the same
`TransactionEvent` leaves the processor, risk engine, persistence and API
untouched (PR-005).
