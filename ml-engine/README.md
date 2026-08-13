# ML engine

Python side of FraudStream AI: preprocessing, training, the pseudo-streaming
generator, the risk engine and the FastAPI service.

## Layout

```
ml-engine/
  data/                     datasets and generated artifacts (git-ignored)
  models/                   serialised model, preprocessor, metadata
  notebooks/                exploratory notebooks (optional)
  src/
    config.py               paths, risk bands, thresholds, settings
    preprocessing/          loading, cleaning, time-aware split, scaling
    features/               feature engineering + derived identity attributes
    training/               training pipeline, evaluation, threshold tuning
    inference/              single-transaction predictor with latency timing
    streaming/              the generator, processing loop, stream state
    risk/                   risk bands and account risk aggregation
    persistence/            buffered Supabase writer
    api/                    FastAPI app, schemas, auth dependency
  tests/                    pytest suite
```

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
```

The dataset is found in this order: `DATA_PATH`, then `data/creditcard.csv`, then
`creditcard.csv` in the repository or workspace parent folder.

## Training

```powershell
.\.venv\Scripts\python.exe -m src.training.train
```

| Flag | Effect |
| --- | --- |
| `--data PATH` | Use a specific CSV |
| `--max-rows N` | Read only the first N rows |
| `--fast` | Smaller forests, subsampled training split |
| `--models a,b` | Train a subset of candidates |
| `--latency-samples N` | How many single predictions to time (default 500) |
| `--smote` | Oversample the training split with SMOTE |
| `--no-stream-file` | Skip writing `data/stream_test.csv` |

Outputs: `models/fraud_model.joblib`, `models/preprocessor.joblib`,
`models/model_metadata.json`, `data/stream_test.csv`, `data/dataset_profile.json`.

## Serving

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000
```

Interactive docs at `http://localhost:8000/docs`. Endpoint reference in
`docs/api.md`.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

| File | Covers |
| --- | --- |
| `test_generator.py` | Generator contract: one event at a time, lazy reads, clean stop, invalid rows |
| `test_features.py` | Parity between the vectorised and scalar feature paths, leakage guards |
| `test_risk.py` | Risk band edges, threshold anchoring, account aggregation |
| `test_processor.py` | Processing loop, alerting, live confusion matrix, metrics shape |
| `test_latency.py` | Single-transaction latency against the 50 ms budget |
| `test_api.py` | Endpoint surface, validation, stream lifecycle |

Tests needing the trained artifacts skip when they are absent, so the suite runs
in CI without the dataset.

## Design notes

- **Latency is measured, not assumed.** `FraudPredictor.predict` times feature
  construction plus inference and returns it with every prediction.
- **Two feature paths, one definition.** Training uses the vectorised pandas path,
  serving uses a scalar path that avoids allocating a DataFrame per transaction.
  A test asserts they agree.
- **The preprocessor is fitted on training rows only** and serialised separately,
  so serving cannot silently drift from training.
- **Persistence is off the hot path.** The Supabase writer batches on its own
  thread; a database outage slows nothing down and drops nothing silently.
