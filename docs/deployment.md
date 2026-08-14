# Deployment

Target topology:

| Piece | Host |
| --- | --- |
| React frontend | Vercel (or Netlify) |
| FastAPI detection engine | Render (or Railway, Hugging Face Spaces) |
| Postgres, Auth, Realtime | Supabase |
| Source control and CI | GitHub Actions |

---

## 1. Supabase

1. Create a project and note the project URL, anon key and service-role key.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor. It creates the five
   tables, enables RLS, applies the policies and grants, installs the
   `on_auth_user_created` trigger, and adds the detection tables to the realtime
   publication.
3. Optionally run `supabase/seed/seed.sql` so the dashboard has data before the
   first stream.
4. Authentication: enable email/password. For a demo, turning off email
   confirmation lets you sign in immediately after sign-up.
5. Verify Realtime is enabled for `transactions`, `fraud_alerts` and
   `account_risk` under Database, Replication.

---

## 2. Detection engine (Render)

`render.yaml` in the repository root is a Render blueprint, so the fastest path
is **New -> Blueprint -> pick this repository**. Render reads the build command,
start command, health check and the non-secret environment variables from it, and
prompts for the four values marked `sync: false`.

The blueprint sets `rootDir: ml-engine`, so every relative path the engine
resolves (`models/`, `data/`) matches the local layout.

**Build command**

```bash
pip install -r requirements.txt
```

**Start command**

```bash
uvicorn src.api.main:app --host 0.0.0.0 --port $PORT --workers 1
```

Training during the build is not an option: the 150 MB `creditcard.csv` is not
in the repository, so there is nothing to train on. The three files the engine
loads at startup are committed instead, with an explicit `.gitignore` exception
and a `.gitattributes` `binary` rule so the pickles survive cloning intact:

| File | Size |
| --- | --- |
| `ml-engine/models/fraud_model.joblib` | 778 KB |
| `ml-engine/models/preprocessor.joblib` | 2 KB |
| `ml-engine/data/stream_test.csv` | 13.4 MB, 42,560 rows |

To ship a retrained model, run training locally and commit the new artifacts.

**Environment variables**

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key. Server only, never in the frontend |
| `SUPABASE_ANON_KEY` | Anon key, used to verify end-user tokens |
| `MODEL_PATH` | `models/fraud_model.joblib` |
| `PREPROCESSOR_PATH` | `models/preprocessor.joblib` |
| `MODEL_METADATA_PATH` | `models/model_metadata.json` |
| `STREAM_DATA_PATH` | `data/stream_test.csv` |
| `CORS_ORIGINS` | Your deployed frontend origin |
| `REQUIRE_AUTH` | `true` |
| `STREAM_DELAY_MS` | `120` |
| `LOG_LEVEL` | `INFO` |

Notes:

- Free tiers sleep. The first request after a cold start pays model load time;
  `/api/health` is a cheap way to wake it.
- The stream runs in-process on a background thread, so keep a single worker.
  Multiple workers would each run their own stream and their own counters.
- If `data/stream_test.csv` is absent, training regenerates it. Without it the
  engine falls back to the full dataset and logs a warning.

---

## 3. Frontend (Vercel)

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Framework preset | Vite (declared in `frontend/vercel.json`) |
| Build command | auto-detected from `package.json` |
| Output directory | `dist` |
| Install command | auto-detected from the lockfile (`pnpm-lock.yaml` is present, so pnpm) |

Root directory is the one setting you must change by hand; Vercel defaults to the
repository root, where there is no `package.json`. Everything else comes from
`frontend/vercel.json`, which is committed. The build command is deliberately not
pinned there so the detected package manager and the install step stay consistent.

**Environment variables**

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Anon key |
| `VITE_API_URL` | The deployed engine URL |
| `VITE_DEMO_MODE` | `false` |

Vite inlines `VITE_*` variables into the bundle, so only public values belong
here. The service-role key must never appear.

Client-side routing needs a rewrite so deep links work. This is already committed
as `frontend/vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Vercel checks the filesystem before applying rewrites, so hashed assets under
`/assets/` and `/favicon.svg` are still served as files rather than being
swallowed by the catch-all.

Netlify equivalent, in `frontend/public/_redirects`:

```
/*  /index.html  200
```

---

## 4. Wire the pieces together

1. Set `CORS_ORIGINS` on the engine to the exact frontend origin, including the
   scheme and with no trailing slash.
2. Point `VITE_API_URL` at the engine.
3. Redeploy both.

---

## 5. Smoke tests

```bash
# 1. Engine is up and has a model
curl https://<engine>/api/health

# 2. Unauthenticated access is refused when REQUIRE_AUTH=true
curl -i https://<engine>/api/metrics        # expect 401

# 3. Authenticated call works
curl -H "Authorization: Bearer <access token>" https://<engine>/api/metrics
```

Then in the browser:

1. Load the landing page.
2. Sign in; confirm the redirect to `/app`.
3. Confirm the top bar shows "Realtime live".
4. Start the stream; rows should appear in the live monitor.
5. Check Supabase table editor: `transactions` is filling up.
6. Open model analytics; the metrics should match `docs/model-card.md`.

---

## 6. CI

`.github/workflows/ci.yml` runs on push and pull request:

- Installs the Python dependencies and runs `pytest`. Tests that need the trained
  artifacts skip automatically, since the dataset is not committed.
- Installs the frontend dependencies and runs `npm run build`.

---

## Operational notes

| Topic | Detail |
| --- | --- |
| Retraining | Re-run the training command, redeploy the artifacts, and update `frontend/src/data/modelFacts.js` if the landing page numbers changed |
| Backups | Supabase handles Postgres backups on paid plans |
| Log noise | Set `LOG_LEVEL=WARNING` to quiet per-transaction logs |
| Write volume | `PERSIST_BATCH_SIZE` controls batching; the queue holds 10,000 rows and drops with a warning when full |
| Scaling out | Move the stream to a worker process and replace the generator with a Kafka or Redis Streams consumer |
