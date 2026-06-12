# Concise

A minimalist personal finance tracker. Black theme, gold accents, mobile-first.

Track assets and liabilities, watch your net worth over time, automate
recurring financial movements, and keep market-valued holdings up to date —
all in a fast, private, self-hostable app.

## Features

- **Dashboard** — total assets, liabilities, and net worth with an
  interactive history graph (1M / 3M / 6M / YTD / 1Y / 5Y / 10Y / 20Y / All,
  full-screen mode), a trend line with an adjustable rolling-average window
  (slider next to the graph; stable across range changes), graph smoothing
  that ramps sparse manual revaluations over the gap instead of one-day
  cliffs, and age markers on 5-year-plus ranges (set your birth year in
  Settings → Calculation).
- **Historical view mode** — drag the red circle under the graph to pin the
  whole app to a past date: every page shows the portfolio exactly as it
  stood then (later entries vanish, values are as-of), survives navigation,
  and a floating reset button returns to today.
- **Assets & liabilities** — multiple entries per class, each with a unique
  emoji (💵 cash, 📈 stock investments, 🏠 property, 🚗 vehicles, 🪙 crypto,
  🥇 precious metals with gold/silver/platinum/palladium sub-selection, 📦
  other / 🏦 mortgage, 💸 loans, 💳 credit cards, 🎓 student loans, ⚖️
  other), full value history per entry, and optional backdating on creation.
- **Valuation methods per category** — cash is always a manual figure;
  anything tradable can be market-priced (symbol × quantity with a
  verification step); property can auto-apply a country's yearly average
  price change; vehicles can auto-depreciate by age from their manufacture
  date. Backdated auto-valued entries are backfilled with one historically
  accurate value per day — entries whose history the provider cannot price
  are flagged on the page.
- **History editing** — Settings → History lists every historic entry across
  all holdings for editing or deletion, and accepts legacy wealth points
  ("on X date my net worth was Y") that appear on the graph.
- **Recurring movements** — scheduled fixed or percentage changes (salary
  into savings, mortgage payments, compounding interest, …) on daily,
  weekly, monthly, quarterly or yearly cadences, applied automatically.
- **Multi-user** — self-service account creation, session auth, rate
  limiting, and audit logging.

## Tech stack

Node.js 24 + TypeScript + Express 5 + SQLite (`node:sqlite`) on the backend;
React 19 + Vite + Tailwind CSS v4 + Recharts on the frontend. Tests with
Vitest, supertest, Testing Library, and Playwright. See
[ARCHITECTURE.md](ARCHITECTURE.md).

## Run locally

Requires Node.js ≥ 24.

```bash
npm install
npm run db:migrate    # create data/concise.db
npm run db:seed       # demo user + sample portfolio
npm run dev           # API on :3000, web on :5173 (proxied)
```

Open http://localhost:5173 and log in with the demo account:

```
username: demo
password: demo
```

## Scripts

| Command              | What it does                                  |
|----------------------|-----------------------------------------------|
| `npm run dev`        | Backend (tsx watch) + frontend (Vite) together |
| `npm run db:migrate` | Apply SQL migrations                          |
| `npm run db:seed`    | Seed demo user and sample portfolio           |
| `npm test`           | All unit + integration tests                  |
| `npm run build`      | Production build (server bundle + static web) |
| `npm start`          | Run the production build (serves API + web)   |

## Running in production

The whole app is one Node process. Build, then start:

```bash
npm run build     # server bundle (esbuild) + static web (Vite)
npm start         # serves the API and the built SPA on $PORT (default 3000)
```

Set `NODE_ENV=production` (enables `Secure` cookies — serve over HTTPS) and a
persistent `DB_PATH`. Behind a reverse proxy, set `TRUST_PROXY=1` so client IPs
are correct, and `TRUSTED_ORIGINS` if the frontend is hosted on a different
origin. Back up by copying the SQLite file (WAL mode — copy `*.db`, `*.db-wal`,
`*.db-shm` together, or checkpoint first). See [ARCHITECTURE.md](ARCHITECTURE.md).

| Env var            | Default            | Purpose                                   |
|--------------------|--------------------|-------------------------------------------|
| `PORT`             | `3000`             | HTTP port                                 |
| `DB_PATH`          | `../data/concise.db` | SQLite file location                    |
| `NODE_ENV`         | `development`      | `production` enables Secure cookies       |
| `SESSION_TTL_HOURS`| `336` (14 days)    | Session lifetime                          |
| `TRUST_PROXY`      | `0`                | Hops to trust for client IP               |
| `TRUSTED_ORIGINS`  | (none)             | Extra CSRF-trusted origins, comma-sep     |
