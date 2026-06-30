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
  Settings → Calculation). A **Nominal / Real** toggle re-expresses the graph
  and the percent-change badges in today's money (rough inflation adjustment),
  so long-range growth reflects real progress rather than nominal drift.
- **Historical view mode** — drag the red circle under the graph to pin the
  whole app to a past date: every page shows the portfolio exactly as it
  stood then (later entries vanish, values are as-of), survives navigation,
  and a floating reset button returns to today.
- **Assets & liabilities** — multiple entries per class, each with a unique
  emoji (💵 cash, 📈 stock investments, 🏠 property, 🚗 vehicles, 🪙 crypto,
  🥇 precious metals with gold/silver/platinum/palladium sub-selection, 📦
  other / 🏦 mortgage, 💸 loans, 💳 credit cards, 🎓 student loans, ⚖️
  other), full value history per entry, optional backdating on creation (with
  an optional present-day value), a running total of each side beside the page
  heading, a current per-unit price on each market holding, and a badge marking
  any entry that an active recurring increase/decrease applies to.
- **Valuation methods per category** — cash is always a manual figure;
  anything tradable can be market-priced (symbol × quantity with a
  verification step) across many instruments on several exchanges (London,
  US, Europe, crypto, spot metals), with prices converted from the
  instrument's currency into yours; property can auto-apply a country's yearly
  average price change; vehicles can auto-depreciate by age from their
  manufacture date (anchored on a present-day value when you give one).
  Backdated auto-valued entries are backfilled with one historically accurate
  value per day — entries whose history the provider cannot price are flagged
  on the page.
- **Multi-currency** — pick your display currency; switching re-denominates
  your whole portfolio and history at rough exchange rates, and any value
  pulled in a foreign currency is converted before it is used.
- **History editing** — Settings → History lists every historic entry across
  all holdings for editing or deletion, and accepts legacy wealth points
  ("on X date my net worth was Y") that appear on the graph.
- **Recurring movements** — scheduled fixed or percentage changes (salary
  into savings, mortgage payments, compounding interest, …) on daily,
  weekly, monthly, quarterly or yearly cadences, applied automatically.
- **Goals & prediction** — set a target net worth or pick a liability to pay
  off; each goal tracks progress, a projected ETA, and a suggested monthly
  contribution (one click turns a payoff goal's suggestion into a recurring
  payment). **Prediction mode** projects the whole portfolio forward to a
  chosen horizon — the cards, breakdowns and graph all reflect the future —
  and draws a gold marker line at each enabled goal's projected date, labelled
  with the goal name and a progress hover (toggle a goal's line on or off in
  Settings → Goals).
- **Multi-user** — self-service account creation, session auth, rate
  limiting, and audit logging. A "not financial advice" disclaimer appears on
  sign-up and in Settings → Legal.
- **Database backups** — validated point-in-time copies of the SQLite file,
  taken automatically on a configurable interval (on by default), on startup
  when the last one is stale, or on demand from Settings → Backup. A bounded
  number are kept (manual and automatic pruned together). See [BACKUP.md](BACKUP.md).

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
origin. Concise takes its own validated backups (automatic + manual; see
[BACKUP.md](BACKUP.md)) into `BACKUP_DIR` — keep that on persistent storage and
copy it off-host for disaster recovery. See [ARCHITECTURE.md](ARCHITECTURE.md).

| Env var            | Default            | Purpose                                   |
|--------------------|--------------------|-------------------------------------------|
| `PORT`             | `3000`             | HTTP port                                 |
| `DB_PATH`          | `../data/concise.db` | SQLite file location                    |
| `BACKUP_DIR`       | `<dirname(DB_PATH)>/backups` | Where database backups are written |
| `NODE_ENV`         | `development`      | `production` enables Secure cookies       |
| `SESSION_TTL_HOURS`| `336` (14 days)    | Session lifetime                          |
| `COOKIE_SECURE`    | (prod: `true`)     | Send `Secure` cookies (requires HTTPS)    |
| `TRUST_PROXY`      | `0`                | Hops to trust for client IP               |
| `TRUSTED_ORIGINS`  | (none)             | Extra CSRF-trusted origins, comma-sep     |
| `API_RATE_LIMIT`   | `300`              | API requests per IP per minute            |
| `LOGIN_RATE_LIMIT` | `10`               | Login attempts per IP per 15 minutes      |
| `SEED_ON_START`    | `0`                | `1` (re)seeds the demo account at startup |
| `PRICE_PROVIDER`   | `real`             | Market price source: `real` (live Yahoo Finance quotes, no API key) or `simulated` (deterministic offline) |
| `LOG_LEVEL`        | `info`             | Log verbosity: `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent` |

## Run with Docker

The repo ships a multi-stage [Dockerfile](Dockerfile) (it builds the server
bundle and static SPA, then assembles a slim runtime image) and a
[docker-compose.yml](docker-compose.yml) template. The image runs as a non-root
user, applies migrations on startup, and stores the SQLite database on a volume
mounted at `/data`.

```bash
cp .env.docker.example .env     # adjust for your deployment
docker compose up -d --build
```

Open http://localhost:3000. Set `SEED_ON_START=1` in `.env` to create the demo
account (`demo` / `demo`) on first run. Testing over plain HTTP on `localhost`?
Uncomment `COOKIE_SECURE=false` in `.env` first, or logins silently fail (see
the HTTPS note below).

Without Compose:

```bash
docker build -t concise .
docker run -d --init --name concise -p 3000:3000 -v concise-data:/data concise
```

- **Serve over HTTPS.** `COOKIE_SECURE` defaults to `true`, so session cookies
  require HTTPS — put Concise behind a TLS-terminating reverse proxy (Caddy,
  nginx, Traefik). For local plain-HTTP testing on `localhost` only, add
  `-e COOKIE_SECURE=false` (otherwise logins silently fail). Behind a proxy also
  set `TRUST_PROXY=1` (correct client IPs) and `TRUSTED_ORIGINS` if the SPA is
  served from another origin.
- The database is the `/data` volume; Concise writes its own validated backups
  to `/data/backups` (automatic + manual — see [BACKUP.md](BACKUP.md)). Copy the
  volume off-host as well for true disaster recovery.
- The container runs as a non-root user and exposes `GET /api/health` for the
  built-in healthcheck and external probes. A richer `GET /api/health/detailed`
  reports the UI, server and database status (never any financial data) for
  dashboards and monitors — see [HEALTHCHECK.md](HEALTHCHECK.md).

See [.env.docker.example](.env.docker.example) for all tunables.

## Health checks

Concise exposes a simple liveness probe (`GET /api/health` → `{ ok: true }`) and
a detailed readiness probe (`GET /api/health/detailed`, checking UI, server and
database) for unraid / Docker / Uptime Kuma. Neither ever reports financial
data. See [HEALTHCHECK.md](HEALTHCHECK.md).

## Logs

Concise writes structured JSON logs to stdout (via pino), so `docker logs`,
journald or a log shipper just work. Every `/api/*` request carries a
correlation id — sent back as the `x-request-id` header and included in a
`request completed` log line (method, path, status, duration, client IP, user
id) — so an issue can be traced end to end. Logs report only operational facts,
never financial data, passwords or session tokens. Per-request lines are emitted
at `info`; set `LOG_LEVEL` to `debug` to additionally log liveness health-check
polls, or `silent` to disable.

## Security

Concise hashes passwords with scrypt, uses revocable opaque sessions, scopes
every query by user, validates all input with zod over parameterised SQL, and
applies CSRF checks, rate limiting and a strict CSP. The full security posture,
how to **report a vulnerability**, and a hardening checklist for self-hosters
are in [SECURITY.md](SECURITY.md). Concise is a tracking tool, **not financial
advice** — see the in-app disclaimer on sign-up and in Settings → Legal.
