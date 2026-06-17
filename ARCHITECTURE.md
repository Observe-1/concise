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
  deployment artifact. Backups are a (checkpoint + validate) file copy — built
  in; see [BACKUP.md](BACKUP.md).
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
| Run (prod) | `npm run build` → `npm start` (one Node process serves API + static SPA) | Single artifact, minimal manual steps |

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
| `settings` | Per-user prefs | `currency` (ISO 4217), `birth_year` (age overlay on long-range charts); `display_name` lives on users |
| `assets` | Asset entries | `category` ∈ cash, investments, property, vehicles, crypto, precious_metals, other; `metal` sub-selection (gold/silver/platinum/palladium) only on precious_metals; `market_symbol` + `quantity` for market-valued assets, `country` for property-index assets, `manufacture_date` for depreciating vehicles (`valuation_mode` manual\|market\|property_index\|depreciation). Valuation methods are category-gated (`ASSET_VALUATION_MODES`): cash is manual-only; property and vehicles are never market-priced — property is manual or property_index, vehicles manual or depreciation |
| `asset_valuations` | Value history | Append-only; `source` ∈ manual, recurring, market, seed. Current value = latest row |
| `liabilities` | Liability entries | `category` ∈ mortgage, loan, credit_card, student_loan, other. Balances stored positive |
| `liability_valuations` | Balance history | Mirrors asset valuations |
| `recurring_transactions` | Recurring movements | `amount_type` ∈ fixed (signed `amount_minor` delta) \| percent (signed `percent` of current value, compounds), `cadence` ∈ daily, weekly, monthly, quarterly, yearly, `next_run_on` date cursor; CHECKs enforce exactly one target and exactly one of amount/percent |
| `snapshots` | Daily net-worth | `UNIQUE(user_id, snapshot_date)`; assets/liabilities/net-worth totals; `source` ∈ computed, legacy — legacy rows are user-entered past net-worth points that recomputation never overwrites. Graphs read this table |
| `audit_log` | Security audit | Auth events + mutations, with IP |
| `backup_settings` | Database-backup config | A **single global row** (`id = 1` CHECK) — backups cover the whole DB, not one user. Holds the filename prefix, retention count, automatic-backup toggle (on by default) and interval. See [BACKUP.md](BACKUP.md) |

**History strategy:** valuations are append-only per entry; `snapshots` is the
denormalized daily aggregate that powers the dashboard graph. Snapshots are
upserted (idempotent) by: a daily job, and inline after any mutation that
changes today's totals. Deleting an asset hard-deletes its valuations
(CASCADE) but never rewrites past snapshots — net-worth history is preserved.

**Graph smoothing:** when a holding's next valuation is a *manual*
revaluation recorded after a multi-day gap, snapshot recomputation
interpolates the value linearly across the gap (the change happened over the
period, not on the day it was typed in), so the graph ramps instead of
showing a one-day cliff. Recurring, market and seed valuations are discrete
events and keep step semantics. Because smoothing looks one entry ahead,
mutations recompute from the holding's previous anchor, not just the changed
day.

## 4. Core flows

### Auth
0. `POST /api/auth/register` (rate-limited) — self-service signup: validated
   username/password, case-insensitive uniqueness, default settings row,
   automatic login.
1. `POST /api/auth/login` (rate-limited) — verifies scrypt hash with
   `timingSafeEqual` (a dummy hash is verified for unknown usernames so
   timing reveals nothing), creates a session row (token hashed), sets an
   `httpOnly` + `SameSite=Lax` (+ `Secure` in prod) cookie.
2. `requireAuth` middleware loads the session on every `/api` request,
   rejects expired/unknown tokens, slides expiry.
3. CSRF: mutating requests must carry an `Origin`/`Referer` that is trusted —
   same-origin as the request `Host` (production: the SPA is served by the
   backend), an entry in `TRUSTED_ORIGINS`, or a loopback origin outside
   production (so the Vite dev proxy works). Cookie is also `SameSite=Lax`.
   Login attempts and all mutations are audit-logged.

### Assets / liabilities
- CRUD under `/api/assets` and `/api/liabilities` (identical shape).
- Creating a **liability** accepts an optional `interestRatePct`: the route
  then auto-creates a yearly `percent` recurring schedule ("<name> interest")
  that grows the balance by that rate, first accruing one year after the
  entry's start date. It is a normal schedule thereafter (editable/pausable on
  the Recurring page, and subject to the paid-off suspension rule). Assets
  ignore the field.
- Creating an entry writes the entry **and** its first valuation in one
  transaction, then upserts today's snapshot. An optional `asOf` backdate
  starts the entry's history on a past date and rebuilds daily snapshots from
  there. Backdated **market** entries are backfilled with one valuation per
  day priced as of each date (historically accurate, not flat at one old
  price); days the provider cannot price are skipped and flag the asset
  (`history_price_missing` → `historicalPriceMissing`), which the holdings
  page shows as a hoverable "incomplete history" label. A backdated,
  non-market entry may also carry an optional **present-day value**, recorded as
  a second valuation today in addition to the historic one (the graph ramps
  between them). For vehicle **depreciation** a present-day value is special: it
  anchors the curve on today and the historic value is ignored — the past is
  reconstructed by reversing depreciation from the current value (see §4 Market
  valuations).
- `GET /api/assets|liabilities/changes?range=1M|…|ALL` returns each holding's
  percent change over the range (`{ id, changePct }`): the base is the latest
  valuation on or before the period start (ALL measures from the first
  valuation), `changePct` is `null` when the holding had no value then (didn't
  exist yet) or the base was zero. `asOf` scopes it to the historical view.
  The holdings pages render this as a green/red/grey badge per holding under a
  range quick-select, and show a **running total** of the side (sum of every
  entry's current value) next to the page heading — as-of in the historical
  view. Each market holding also shows its current per-unit price (derived from
  value ÷ quantity) in its gold badge, and any holding with an active recurring
  schedule gets a gold badge summarising the increase/decrease (signed
  amount/percent + cadence, schedule name on hover).
- "Update value" appends a `manual` valuation row (history preserved), then
  upserts today's snapshot. For model-valued holdings this **re-anchors** the
  automatic estimate: the property-index and depreciation formulas grow from
  the latest `manual` valuation (the most recent figure the user typed in),
  not the original base, so an update re-bases all future automatic
  calculations on the new number while the old entries stay intact. The web
  edit form exposes a value field for model holdings so they can be re-anchored.

### Settings (web)
- `/settings/:section?` renders four sub pages selected by buttons at the
  top: **User account** (profile, sign out, **Danger zone** — the default),
  **History** (legacy wealth, historic-entry editor), **Calculation**
  (currency — switching re-denominates the whole portfolio at the latest rough
  rate, §6.4 — and birth year), and **Backup** (how backups work, existing backups
  with age/size, a "Back up now" button, and the backup settings). The first
  three share `GET/PATCH /api/settings`; Backup uses `/api/backup` (see
  [BACKUP.md](BACKUP.md)).
- **Delete all data:** `POST /api/settings/delete-all` wipes the user's
  assets, liabilities (and their valuations via cascade), recurring schedules
  and snapshots, leaving the account, session and preferences intact and a
  fresh zero baseline snapshot for today. The body must carry
  `confirm: "delete all"` (server backstop); the UI's Danger zone gates it
  behind a "100% sure" tickbox and a text box requiring the exact phrase,
  showing an error otherwise.

### History editing (`/api/history`)
- `GET /entries` lists every valuation across the user's holdings (filter by
  side/holding); `PATCH`/`DELETE /entries/:side/:id` edit values, move dates,
  or remove entries — snapshots are rebuilt from the earliest affected date.
  The last remaining entry of a holding cannot be deleted. In the web history
  editor, automatically generated entries (any `source` other than `manual` —
  recurring, market, seed) are tinted and badged "Auto", with a toggle to hide
  them so only hand-entered values remain.
- `POST /legacy` upserts a legacy net-worth point (snapshot with
  `source='legacy'`); `DELETE /legacy/:date` removes it, restoring computed
  data where valuations cover the date.

### Recurring transactions
- Each row holds a `next_run_on` cursor. The engine (job tick + on-login
  catch-up) processes all rows with `next_run_on <= today` in a transaction:
  append a valuation (fixed: latest value + signed amount; percent: latest
  value × (1 + pct/100), compounding per occurrence — both floored at 0),
  advance the cursor by cadence (month-end clamped), repeat until caught up.
  Idempotent and safe across downtime.
- **Paid off:** when an occurrence drives a **liability** balance to zero or
  below, the balance is set to 0 and *every* recurring schedule against that
  liability is suspended (`active = 0`) — no further payments or interest run
  until the user reactivates it. Assets only floor at 0 and keep running. The
  liabilities page badges a zero-balance liability "✓ Paid off".

### Dashboard
- `GET /api/dashboard/summary` — current totals + per-category breakdown
  computed from latest valuations. With `?predict=1&range=…[&asOf=…]`
  (prediction mode) it instead returns the portfolio **projected** forward —
  the same per-holding maths as the prediction graph — so every card reflects
  the future: projected to the range's forward horizon by default, or to the
  view-as date when one is pinned (a non-future date / the ALL range falls back
  to the live summary).
- `GET /api/dashboard/changes?range=…[&asOf=…]` — percent change of the
  assets, liabilities and net-worth totals over the range, read from the
  snapshot series (so it matches the graph): base = latest snapshot on or
  before the period start (ALL from the earliest snapshot), each field `null`
  when there is no base snapshot or the base is ≤ 0 (net worth can be
  non-positive). The summary cards show these as green/red/grey badges keyed
  to the graph's selected range. With `?predict=1` the percentages become
  projected **growth from today's live totals** to the projected (horizon or
  view-as) date.
- `GET /api/dashboard/history?range=1M|3M|6M|YTD|1Y|5Y|10Y|20Y|ALL&trendWindow=N` —
  snapshot series for the graph. Every point carries `trendMinor`: a centred
  moving average (window `trendWindow` days, 7–365, default 91 — the UI
  exposes it as a slider next to the graph's expand button) computed over the
  **full** history before the range is sliced, so a date's trend value is
  identical whatever range is requested (the trend never re-fits to the
  visible window).
- The chart shows a muted age marker (vertical line labelled "Age N") when
  the user has set a birth year and the visible series spans ≥ 5 years.

### Prediction mode
- `GET /api/dashboard/prediction?range=…` (`modules/dashboard/prediction.ts`)
  returns a small slice of real history (≈ range/10) followed by **on-the-fly**
  projected future values out to the range's forward horizon
  (`rangeForwardEnd`), plus the `today` boundary date. Nothing is persisted.
  Projection per holding: market holdings grow by their average annualised
  return over the last ~10 years (or the max the provider supplies), clamped
  to ±40%; property/depreciation holdings continue their model formula from
  the re-anchorable base; manual holdings (and liabilities) follow their
  active recurring schedules (fixed/percent, floored at 0, with the same
  paid-off suspension rule). ALL has no bounded future and is rejected.
- The dashboard has a golden "Prediction mode" button at the bottom. While
  active the graph shows the projected series with a dotted gold "Now" line at
  `today`, the trend line is hidden, MAX is removed from the range picker, and
  a floating golden "Exit prediction" button appears (shifted up when the red
  "view as" exit button is also showing). "View as" still works over the
  projected series — the scrubber handle defaults to the latest projected
  date.
- **Every surrounding number follows the projection too**, not just the hover
  tooltip: the summary cards (net worth / assets / liabilities), their
  per-category breakdowns, and the percentage badges all read from the
  prediction (`useSummary`/`useDashboardChanges` send `predict=1`). They show
  the portfolio projected to the horizon by default, or to the view-as date
  when the scrubber is dragged into the future; the percentages are projected
  growth vs today, captioned "projected". The projected summary at the horizon
  equals the graph's final point, so card and chart agree. The projection is
  computed once in `projectPortfolioAt` (an extract of the prediction engine's
  per-holding projection), shared by the graph series and the summary/changes
  routes so all three stay consistent.

### "View as" mode (historical view)
- A red scrubber pins the app to a past date (`asOf`). The scrubber is drawn
  **along the dashboard chart's X axis** (one bar, not a separate slider row):
  its track spans the plot area and its circular grab handle (a fixed-diameter
  `.scrubber` thumb) rides in a lane just above the X-axis date labels — the
  XAxis band reserves a label row plus the handle lane and pushes the labels
  down (`tickMargin`) so the handle never overlaps them.
  `GET /api/assets|liabilities|dashboard/summary?asOf=YYYY-MM-DD`
  return the portfolio exactly as it stood at the end of that day: values are
  the latest valuation on or before the date, and entries whose history
  starts later are omitted entirely.
- Client state lives in `HistoricalViewContext` (persisted to sessionStorage
  so it survives page changes). While active: a subtle red frame surrounds
  every page, a floating "Exit view as" button restores the live view, the
  chart shows a red marker on the pinned date, and the holdings pages become
  read-only (mutating the past from this lens would be misleading). Recurring
  schedules and settings are not date-scoped.

### Database backups (`/api/backup`, see [BACKUP.md](BACKUP.md))
- A backup is a validated point-in-time copy of the SQLite file:
  `PRAGMA wal_checkpoint(TRUNCATE)` flushes the WAL into the main file, the file
  is copied to `BACKUP_DIR` (default `<dirname(DB_PATH)>/backups`), and the copy
  is re-opened read-only and `PRAGMA integrity_check`-ed before success is
  reported. node:sqlite is synchronous and the app is single-process, so no
  write interleaves the copy.
- **Automatic** backups (on by default) are an interval job: the scheduler
  checks every tick (a cheap directory stat) whether the newest backup is older
  than the configured interval — or absent — and takes one if so. Because the
  scheduler ticks immediately on startup, this also performs the "back up now if
  stale on boot" catch-up. **Manual** backups (`POST /api/backup/run`) run the
  same path. After every backup, retention prunes the pool (manual + automatic
  together) to the most recent N.
- The list of backups is derived from the filesystem (the source of truth, so a
  hand-deleted file is reflected at once); only behaviour lives in
  `backup_settings`. `GET /api/health/detailed` surfaces a non-sensitive backup
  block (last time/name, location, count) for monitors.

### Market valuations
- Assets with `valuation_mode='market'` hold a `market_symbol` and `quantity`.
- A `PriceProvider` interface supplies prices, symbol lookup, an instrument's
  quote currency (`instrumentCurrency`) and the full instrument list
  (`listInstruments`); `getPriceMinor` returns `null` for dates outside the
  provider's coverage and prices in the instrument's own currency. The default
  `SimulatedPriceProvider` is a deterministic seeded random walk over a fixed
  instrument list spanning several exchanges and currencies — London (GBP, e.g.
  VUAG/VWRP/VUKE/ISF), US (USD, NASDAQ/NYSE), Europe (EUR, Xetra/Euronext),
  crypto and spot metals (USD) — with no API keys, stable for tests, data from
  2020-01-01. A real provider can be swapped in via one factory.
- `GET /api/market/instruments` lists every known instrument (symbol, name,
  exchange, currency) for the asset form's symbol autocomplete.
  `GET /api/market/lookup?symbol=` resolves a ticker to its instrument (name,
  exchange, quote currency and current per-unit price); the asset form requires
  this verification before a market entry is saved and shows the resolved
  exchange, currency and current price.
- **Model methods** (`modules/market/models.ts`): property assets may use
  `valuation_mode='property_index'` — the value grows from the entry's first
  (base) valuation by the chosen country's long-run yearly average property
  price change (`GET /api/market/property-countries` lists the static table).
  Vehicle assets may use `valuation_mode='depreciation'` — average age-based
  depreciation (20%/yr under 1 year old, 15%/yr to 5 years, 10%/yr after,
  floored at 5% scrap value) derived from the required `manufacture_date`.
  Both formulas grow from the holding's **latest `manual` valuation** (its
  re-anchorable base), so "Update value" re-bases them; backdated model
  entries backfill one valuation per day like market entries. (Property and
  vehicles are never `market`-valued — they are not exchange-traded.) When a
  backdated depreciating vehicle is given a **present-day value**, depreciation
  is anchored on *today's* value instead of the historic one: the backfill
  reverses the depreciation curve from the present value back over the period
  (older = worth more) and the historic figure is not used.
- Daily job + `POST /api/market/refresh` append valuations for every
  auto-valued asset (market price or model formula), at most one per day.
- **Currency**: market prices come in the instrument's own currency and are
  converted to the user's currency (rough static rates, `lib/fx.ts`) before
  being stored — on create, on re-price, and across the backdated backfill.
  Model/manual values are entered in the user's currency, so they need no
  conversion. See §6.4.

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
│       ├── modules/      # auth/ assets/ liabilities/ recurring/ backup/
│       │                 # dashboard/ market/ settings/  (routes + service)
│       ├── jobs/         # scheduler + recurring/snapshots/market/backup jobs
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
4. **Single-currency storage with rough FX** — every stored figure is
   denominated in the user's chosen currency. Foreign values are converted at a
   small static table of rough rates (`lib/fx.ts`, units-per-USD, no live feed):
   a market price arriving in the instrument's own currency is converted before
   it is stored or used, and **changing the currency setting re-denominates the
   whole portfolio and its history** at the latest rate (a single constant
   factor, so the graph's shape is preserved — only the units change). Rates are
   deliberately approximate, mirroring the static property-index table.
5. **In-process scheduler over external cron** — one artifact to deploy; jobs
   are idempotent so missed ticks self-heal on next start.
6. **Server runtime is compiled** — dev uses `tsx watch`; production runs
   `esbuild`-bundled JS. The web build is static files served by Express.

## 7. Deployment

The single-process / single-file-DB shape (§1) makes the container trivial: one
image, one port, one volume.

- **Multi-stage [Dockerfile](Dockerfile)** — a `build` stage runs `npm ci` and
  `npm run build` (esbuild server bundle + Vite static SPA); a `prod-deps` stage
  installs production-only `node_modules`; the `runtime` stage (slim, non-root
  `node` user) copies the bundle, the static SPA, and the prod deps. No compiler
  in the final image — `node:sqlite` is built in, and the project has no native
  dependencies by design (§1).
- **Migrations travel with the bundle** — `migrate.ts` reads `*.sql` from
  `import.meta.dirname/migrations`, i.e. next to the running file. esbuild emits
  only `dist/index.js`, so the Dockerfile copies `src/db/migrations` to
  `dist/migrations`. Migrations run automatically on startup (`index.ts`); the
  scheduler self-heals missed ticks (§6.5), so a container restart needs no
  manual steps.
- **State is the volume** — `DB_PATH` points at `/data/concise.db` on a mounted
  volume owned by the runtime user. The app writes its own validated backups to
  `BACKUP_DIR` (default `/data/backups`, same volume) automatically and on
  demand — see [BACKUP.md](BACKUP.md); copy the volume off-host as well for
  disaster recovery.
- **Config is env-only** — [config.ts](server/src/config.ts) is the single
  source of runtime knobs; the [docker-compose.yml](docker-compose.yml) and
  [.env.docker.example](.env.docker.example) templates surface them. Behind a
  reverse proxy, set `TRUST_PROXY` (correct client IPs for rate limiting and the
  audit log) and `COOKIE_SECURE=true` over HTTPS.
- **Health** — `GET /api/health` returns `{ ok: true }` (liveness); the image's
  `HEALTHCHECK` polls it with Node's global `fetch` (no curl in the slim image).
  `GET /api/health/detailed` is a readiness probe that checks the UI, server and
  database (returning `503` when the database is unreachable). Both are
  unauthenticated and report only operational status — never any financial data.
  See [HEALTHCHECK.md](HEALTHCHECK.md).
