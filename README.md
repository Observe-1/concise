# Concise

A minimalist personal finance tracker. Black theme, gold accents, mobile-first.

Track assets and liabilities, watch your net worth over time, automate
recurring financial movements, and keep market-valued holdings up to date —
all in a fast, private, self-hostable app.

## Features

- **Dashboard** — total assets, liabilities, and net worth with an
  interactive history graph (1M / 3M / 6M / YTD / 1Y / 5Y / All, full-screen
  mode).
- **Assets & liabilities** — multiple entries per class (cash, investments,
  property, vehicles, crypto, … / mortgage, loans, credit cards, …), full
  value history per entry.
- **Recurring movements** — scheduled increases/decreases (salary into
  savings, mortgage payments, …) applied automatically.
- **Market valuations** — symbol-linked holdings refreshed by a pluggable
  price provider.
- **Multi-user** with session auth, rate limiting, and audit logging.

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

## Deployment

Single Docker container: the Node process serves the API and the built
frontend; SQLite lives on a mounted volume (back up by copying the file).
CI runs lint, typecheck, and the full test suite. See
[ARCHITECTURE.md](ARCHITECTURE.md) and `deploy/` for details and runbooks.
