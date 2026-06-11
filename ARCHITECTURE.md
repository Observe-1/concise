# Concise — Architecture

> Code is the source of truth. This document describes the system as implemented.

## 1. High-level system design

Concise is a single deployable unit: one Node.js process that serves a JSON API,
runs background jobs in-process, and (in production) serves the built frontend
as static files. State lives in a single SQLite database file.

```
┌─────────────────────────────────────────────────────┐
│                   Node.js process                    │
│                                                      │
│  ┌────────────┐   ┌───────────────┐   ┌──────────┐  │
│  │ Express 5  │   │  Job scheduler │   │ Static   │  │
│  │ JSON API   │   │  (in-process)  │   │ frontend │  │
│  │ /api/*     │   │  - recurring   │   │ (prod)   │  │
│  └─────┬──────┘   │  - snapshots   │   └──────────┘  │
│        │          │  - market      │                 │
│  ┌─────▼──────────┴───────┐                          │
│  │  Service layer (modules)│                         │
│  └─────┬──────────────────┘                          │
│  ┌─────▼──────────────────┐                          │
│  │  SQLite (node:sqlite)  │──▶ data/concise.db (WAL) │
│  └────────────────────────┘                          │
└─────────────────────────────────────────────────────┘
```

In development the Vite dev server proxies `/api` to the backend.

### Why this shape

- **Single process, single file DB** — a personal finance app for a small
  number of users does not need horizontal scaling. One process means
  background jobs, API, and DB access share one transaction boundary and one
  deployment artifact. Backups are a file copy.
- **`node:sqlite` (built-in)** — synchronous, transactional, zero native build
  step (no node-gyp / prebuilt binary risk on any platform). WAL mode for
  concurrent reads.
- **No ORM** — hand-written SQL behind small repository/service modules. The
  schema is small and stable; raw SQL is simpler, faster, and easier to audit
  than an ORM abstraction.

## 2. Tech stack

| Layer      | Choice                                            | Rationale |
|------------|---------------------------------------------------|-----------|
| Runtime    | Node.js 24 LTS, TypeScript (strict)               | Built-in `node:sqlite`, modern LTS |
| API        | Express 5                                         | Stable, async-aware handlers, huge ecosystem |
| Validation | zod                                               | Schema-first input validation, typed |
| DB         | SQLite via `node:sqlite` (`DatabaseSync`)         | Zero-dependency, transactional, file-based |
| Auth       | Opaque session tokens + scrypt (node:crypto)      | No JWT footguns; sessions revocable server-side |
| Frontend   | React 19 + Vite + TypeScript                      | Mobile-first SPA |
| Styling    | Tailwind CSS v4                                   | Utility-first, design tokens for black/gold theme |
| Data fetch | TanStack Query v5                                 | Server-state caching, mutation invalidation |
| Routing    | React Router v7 (library mode)                    | Standard SPA routing |
| Charts     | Recharts                                          | Interactive area/line charts |
| Tests      | Vitest + supertest (API), Vitest + Testing Library (web), Playwright (e2e) | |
| Deploy     | Docker (single container), GitHub Actions CI      | Single artifact, minimal manual steps |

## 3. Data model

Money is stored as **integer minor units** (cents/pence) — never floats.
Dates are ISO-8601 strings (`YYYY-MM-DD` for dates, RFC 3339 for timestamps).
All user data is scoped by `user_id`; every query filters on it.

```
users 1──* sessions
users 1──1 settings
users 1──* assets 1──* asset_valuations
users 1──* liabilities 1──* liability_valuations
users 1──* recurring_transactions ──▶ (exactly one of asset_id | liability_id)
users 1──* snapshots          (one per user per day; net-worth history)
users 1──* audit_log
```

| Table | Purpose | Key points |
|-------|---------|-----------|
| `users` | Accounts | `username` unique (lowercased), scrypt `password_hash` |
| `sessions` | Login sessions | Stores SHA-256 hash of opaque token; expiry; revocable |
| `settings` | Per-user prefs | `currency` (ISO 4217), `display_name` lives on users |
| `assets` | Asset entries | `category` ∈ cash, investments, property, vehicles, crypto, other; optional `market_symbol` + `quantity` for market-valued assets (`valuation_mode` manual\|market) |
| `asset_valuations` | Value history | Append-only; `source` ∈ manual, recurring, market, seed. Current value = latest row |
| `liabilities` | Liability entries | `category` ∈ mortgage, loan, credit_card, student_loan, other. Balances stored positive |
| `liability_valuations` | Balance history | Mirrors asset valuations |
| `recurring_transactions` | Recurring movements | Signed `amount_minor` delta, `cadence` ∈ daily, weekly, monthly, yearly, `next_run_on` date cursor; CHECK enforces exactly one target |
| `snapshots` | Daily net-worth | `UNIQUE(user_id, snapshot_date)`; assets/liabilities/net-worth totals. Graphs read this table |
| `audit_log` | Security audit | Auth events + mutations, with IP |

**History strategy:** valuations are append-only per entry; `snapshots` is the
denormalized daily aggregate that powers the dashboard graph. Snapshots are
upserted (idempotent) by: a daily job, and inline after any mutation that
changes today's totals. Deleting an asset hard-deletes its valuations
(CASCADE) but never rewrites past snapshots — net-worth history is preserved.

## 4. Core flows

### Auth
1. `POST /api/auth/login` (rate-limited) — verifies scrypt hash with
   `timingSafeEqual` (a dummy hash is verified for unknown usernames so
   timing reveals nothing), creates a session row (token hashed), sets an
   `httpOnly` + `SameSite=Lax` (+ `Secure` in prod) cookie.
2. `requireAuth` middleware loads the session on every `/api` request,
   rejects expired/unknown tokens, slides expiry.
3. CSRF: mutating requests must carry an `Origin`/`Referer` matching the host
   (cookie is also `SameSite=Lax`). Login attempts and all mutations are
   audit-logged.

### Assets / liabilities
- CRUD under `/api/assets` and `/api/liabilities` (identical shape).
- Creating an entry writes the entry **and** its first valuation in one
  transaction, then upserts today's snapshot.
- "Update value" appends a valuation row (history preserved), then upserts
  today's snapshot.

### Recurring transactions
- Each row holds a `next_run_on` cursor. The engine (job tick + on-login
  catch-up) processes all rows with `next_run_on <= today` in a transaction:
  append a valuation (latest value + signed amount, floored at 0 for
  liabilities), advance the cursor by cadence (month-end clamped), repeat
  until caught up. Idempotent and safe across downtime.

### Dashboard
- `GET /api/dashboard/summary` — current totals + per-category breakdown
  computed from latest valuations.
- `GET /api/dashboard/history?range=1M|3M|6M|YTD|1Y|5Y|ALL` — snapshot series
  for the graph.

### Market valuations
- Assets with `valuation_mode='market'` hold a `market_symbol` and `quantity`.
- A `PriceProvider` interface supplies prices; the default
  `SimulatedPriceProvider` is a deterministic seeded random walk (no API keys,
  stable for tests). A real provider can be swapped in via one factory.
- Daily job + `POST /api/market/refresh` append market-sourced valuations.

## 5. Folder structure

```
concise/
├── package.json          # npm workspaces root (server, web)
├── server/
│   └── src/
│       ├── index.ts      # entrypoint: HTTP + job scheduler
│       ├── app.ts        # express app factory (DI: db, clock, prices)
│       ├── config.ts     # env-driven configuration
│       ├── db/           # connection, migrate.ts, migrations/*.sql, seed.ts
│       ├── lib/          # passwords, money, dates, http helpers
│       ├── middleware/   # auth, csrf, rate-limit, errors, audit
│       ├── modules/      # auth/ assets/ liabilities/ recurring/
│       │                 # dashboard/ market/ settings/  (routes + service)
│       ├── jobs/         # scheduler + recurring/snapshots/market jobs
│       └── types/api.ts  # API DTOs (web imports these type-only)
├── web/
│   └── src/
│       ├── api/          # fetch client + typed endpoints
│       ├── components/   # UI building blocks (theme: black/gold)
│       ├── pages/        # Dashboard, Assets, Liabilities, Settings, Login
│       └── hooks/
├── e2e/                  # Playwright tests
└── data/                 # SQLite file (gitignored)
```

## 6. Key technical decisions

1. **Sessions over JWT** — revocation, no client-side token storage, simpler.
2. **Append-only valuations + daily snapshots** — clean separation between
   per-entry history and portfolio-level history; graphs never recompute the
   past.
3. **Testability via injection** — the app factory takes `{ db, now() }` so
   integration tests run on `:memory:` SQLite with a controllable clock.
4. **Single-currency per user** — values are stored in the user's currency;
   no FX conversion (out of scope; currency setting controls formatting).
5. **In-process scheduler over external cron** — one artifact to deploy; jobs
   are idempotent so missed ticks self-heal on next start.
6. **Server runtime is compiled** — dev uses `tsx watch`; production runs
   `esbuild`-bundled JS. The web build is static files served by Express.
