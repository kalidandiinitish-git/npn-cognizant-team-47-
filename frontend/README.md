# Frontend

React 16 dashboard for FraudStream AI: a public landing page and an authenticated
console for live monitoring, alert triage, account risk and model analytics.

## Stack

| Concern | Choice |
| --- | --- |
| UI | React 16.14 (`ReactDOM.render`, classic JSX transform) |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 |
| Charts | Recharts 2 |
| Routing | React Router 5 |
| HTTP | Axios |
| Auth and realtime | `@supabase/supabase-js` v2 |

React 16 is a requirement from the PRD, so the classic JSX runtime is configured
in `vite.config.js` and every JSX file imports React explicitly.

## Setup

```powershell
npm install
copy .env.example .env.local
npm run dev
```

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Anon key. Safe in the browser because RLS is on |
| `VITE_API_URL` | FastAPI engine, default `http://localhost:8000` |
| `VITE_DEMO_MODE` | `true` skips authentication. Local use only |

The service-role key must never appear in this project.

## Structure

```
src/
  main.jsx              ReactDOM.render entry point
  App.jsx               public routes + lazy-loaded console
  console/Console.jsx   authenticated routes inside the app shell
  components/
    Icons.jsx           inline SVG icon set and wordmark
    ui.jsx              cards, badges, tiles, tabs, banners, tables
    landing/            landing page chrome, hero preview, sections
    app/                shell, stream controls, charts, data tables
  context/
    AuthContext.jsx     Supabase session, sign in, sign up, sign out
    StreamContext.jsx   polling, realtime subscriptions, stream actions
  pages/                Landing, Login, Dashboard, Monitor, Alerts,
                        Accounts, Analytics, Dataset, NotFound
  services/api.js       axios client with bearer token injection
  utils/                formatting, risk band presentation, constants
  data/modelFacts.js    measured figures quoted on the public landing page
```

## Data flow

`StreamContext` is the single source of dashboard state:

- Polls `/api/metrics`, `/api/transactions/recent`, `/api/alerts` and
  `/api/accounts/high-risk`. Every 2 s while a stream runs, every 8 s when idle.
- Subscribes to Supabase Realtime for inserts on `transactions` and `fraud_alerts`
  and all changes on `account_risk`, merging by primary key so polling and
  realtime cannot duplicate rows.
- Falls back to polling alone when Supabase is not configured, so the dashboard
  still works against a local engine.
- Exposes a pause switch. The engine keeps scoring and storing; only rendering stops.

## Accessibility

- One `h1` per page, semantic landmarks, labelled tables and form controls.
- Visible keyboard focus rings via `:focus-visible`, plus a skip link on the
  landing page.
- Stream status changes announced through an `aria-live` region.
- Icon-only buttons carry `aria-label`; decorative SVGs are `aria-hidden`.
- Risk is never encoded by colour alone: every band shows a label and a score.
- `prefers-reduced-motion` disables the row animations and the hero cycle.

Full WCAG conformance would need manual testing with assistive technology and an
expert review; this covers the mechanical parts.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server on port 5173 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output on port 4173 |
