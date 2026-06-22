# TODO — single source of truth for progress

**Status: phases 1–6 + feature batches complete. Deployment is out of scope.
The 2026-06-22 batch (real net worth, structured logging, SECURITY.md, legal
disclaimer) is in progress — see the bottom of this file.**

## Phase 1: System architecture
- [x] Tech stack decisions (Node 24 + node:sqlite + Express 5 / React 19 + Vite + Tailwind 4)
- [x] Domain model defined (users, assets, liabilities, valuations, recurring, snapshots, settings, audit)
- [x] ARCHITECTURE.md written
- [x] README.md written
- [x] Folder structure / monorepo layout decided (npm workspaces: server, web)

## Phase 2: Database design
- [x] Workspace scaffolding (root + server package)
- [x] Migration runner (numbered .sql files + schema_migrations table)
- [x] 0001_init.sql — full schema with constraints + indexes
- [x] Seed script: demo/demo user + sample portfolio with backdated history (730 daily snapshots)
- [x] Schema smoke tests (constraints, cascades) — 10 tests passing

## Phase 3: Backend API
- [x] App factory with DI (db, clock, price provider), error handling, validation
- [x] Auth module (login/logout/me, scrypt, sessions, cookies)
- [x] Assets module (CRUD + valuations) — shared holdings module
- [x] Liabilities module (CRUD + valuations) — shared holdings module
- [x] Recurring transactions module + engine (catch-up, cadence advance, zero floor)
- [x] Snapshots (daily upsert + on-mutation refresh + downtime backfill)
- [x] Market valuation module (provider interface + simulated provider + refresh)
- [x] Dashboard aggregation (summary + history ranges + downsampling)
- [x] Settings module
- [x] Job scheduler (in-process tick, idempotent jobs)
- [x] Unit tests (dates, cadence, passwords, provider, downsample)
- [x] Integration tests (API + in-memory DB) — 74 tests, 95% stmt / 83% branch coverage
- [x] Security tests (auth bypass, injection, rate limiting, CSRF, headers)

## Phase 4: Frontend application
- [x] Vite + React + Tailwind scaffold, black/gold theme tokens
- [x] API client + TanStack Query setup (shared DTO types via @api alias)
- [x] Login page (demo hint, error states, rate-limit message)
- [x] App shell (mobile bottom nav / desktop rail, safe-area insets)
- [x] Dashboard (summary cards, interactive graph, range presets, full-screen)
- [x] Assets page (grouped by class, add/edit/delete, value updates, market badges)
- [x] Liabilities page (mirrors assets, liability categories)
- [x] Recurring management UI (add/edit/delete, active toggle)
- [x] Settings page (profile, currency, sign out)
- [x] Component + integration tests (19), accessibility roles/labels, responsive nav
- [x] Production build served by Express with SPA fallback (assetsDir renamed to avoid /assets clash)

## Phase 5: Authentication & security
- [x] Rate limiting (login 10/15min + API 300/min, per IP)
- [x] CSRF protection (origin check on mutating requests)
- [x] Security headers (helmet + CSP, x-powered-by removed)
- [x] Audit logging wired to auth events and all mutations (with IP)
- [x] Uniform-timing login (dummy-hash verify for unknown usernames)
- [x] TRUST_PROXY config so req.ip is the real client behind a reverse proxy
- [x] Security test suite (bypass, injection, type confusion, authz boundaries, forged cookies, oversized payloads)

## Phase 6: Quality assurance
- [x] Playwright e2e: login → asset → liability → recurring execution → net worth → graph → settings/sign-out (8 flows × mobile Pixel 7 + desktop Chrome = 16 tests)
- [x] Regression suite wiring (root npm test = server 79 + web 19; npm run e2e)
- [x] Performance checks (API p95 tripwires in server/test/perf.test.ts; UI render budget in e2e)
- [x] Coverage thresholds enforced (server ≥80% stmt/fn/lines, ≥75% branches)
- [x] E2E knobs: SEED_ON_START, JOB_TICK_MS, LOGIN_RATE_LIMIT envs

## Feature batch (2026-06-11)
- [x] Trend line on graphs — server-computed 91-day centred moving average over the FULL history; stable across range changes (test-enforced)
- [x] Precious metals asset class with gold/silver/platinum/palladium sub-selection (migration 0002, table rebuild)
- [x] Symbol verification step on market-asset creation (GET /api/market/lookup + Verify button; save gated on confirmation)
- [x] Mobile nav: Home centred among the five icons and slightly larger (mobile only)
- [x] Extended 10Y / 20Y graph ranges through the existing pipeline
- [x] Birth year setting + muted "Age N" overlay on charts spanning ≥ 5 years (seed extended to 6 years of history)

## Feature batch (2026-06-12)
- [x] Age lines: one per new age at 5Y, every 2nd age at 10Y, every 4th at 20Y, every 5th at All
- [x] Unique emoji prefix for every asset and liability type (no emoji reused)
- [x] Rename "Investments" to "Stock investments" (display label; DB value unchanged)
- [x] Create account page + register endpoint, button on login page
- [x] Settings: legacy wealth input ("on X date my net worth was Y")
- [x] Optional backdate field when adding an asset/liability
- [x] Settings: view all historic entries and alter them

## Feature batch (2026-06-12 #2)
Implemented strictly in order; one commit per feature.
- [x] 1. Create account page: explicit error message when password requirements
      are not met on submit (no silent native-validation-only behaviour)
- [x] 2. Trend line: slider (left of the expand button, also in full-screen)
      controlling the rolling-average window of the dotted trend line
- [x] 3. Cash assets: no valuation method choice — always manual input
- [x] 4. Graph: a single data point in the selected period renders as a normal
      (full-strength gold) flat line through that point, not a lone dot
- [x] 5. Valuation-method holdings are historically accurate when backdated
      (per-date prices over the whole backfill); entries whose historical
      prices could not be found get a hoverable error label on the
      assets/liabilities page
- [x] 6. Historical view mode: draggable red circle under each graph; subtle
      red page accent while active; all data shown as of the chosen date;
      survives page changes; floating reset button on every page
- [x] 7. Property assets: valuation method applying a country's yearly average
      property price change
- [x] 8. Vehicle assets: valuation method applying average vehicle
      depreciation, with a manufacture-date field for correct depreciation
- [x] 9. Recurring: percentage amounts (e.g. +0.4% monthly) besides fixed
- [x] 10. Recurring: quarterly cadence
- [x] 11. Settings overhaul: sub pages (User account / History / Calculation)
      selectable by buttons at the top
- [x] 12. Graph: deltas between sparse manual entries are smoothed over the
      gap instead of a one-day vertical step

## Feature batch (2026-06-12 #3)
Implemented strictly in order; one commit per feature.
- [x] 1. Remove the market-price valuation method from property and vehicle
      assets (they keep manual + their model method)
- [x] 2. Historic entries (Settings → History): highlight automatically
      generated entries and add a toggle to hide them
- [x] 3. Re-anchor on update: updating a holding's value never overwrites the
      historical value/date, but subsequent automatic calculations
      (model/market valuations) work from the new value as their base
- [x] 4. Assets/Liabilities pages: 1M/3M/6M/YTD/1Y/5Y/10Y/20Y/MAX quick-select
      at the top showing each holding's % change over the period (growth
      green, decline red, N/A grey)
- [x] 5. Dashboard: % change next to values on the summary cards, driven by
      the graph's existing range toggles
- [x] 6. "Paid off": a liability whose balance would go negative (percentage
      change or recurring payments) is set to 0 and its recurring payments
      are suspended
- [x] 7. Liabilities: interest-rate field when adding a new one; when filled
      in it auto-creates a recurring entry increasing the value by that %
- [x] 8. Historical mode renamed to "View as"; its slider is incorporated into
      the graph's X axis (single bar, circle handle aligned with the X labels)
- [x] 9. Prediction mode: golden button at the bottom of the dashboard; graph
      projects future values on the fly (valuation methods, recurring
      payments, stocks via average returns over the last 10 years or max
      available); shows a small slice of history (~1/10 of the selected
      range); MAX hidden in this mode; dotted line marks today; View-as still
      works over future values (handle defaults to the latest date); golden
      exit button that shifts when both modes are active
- [x] 10. Settings: delete all data for the account, gated by a confirmation
      tickbox and typing "delete all" exactly (error message otherwise)

## Feature batch (2026-06-17)
Implemented strictly in order; one commit per feature.
- [x] 1. Backdated holdings: an optional **present-day value** field (in addition
      to the historic value) recorded as a second valuation today. For vehicle
      **depreciation**, when a present-day value is given the curve is anchored
      on it (today) and the historic value is ignored — depreciation is computed
      from the current value only; otherwise it operates normally.
- [x] 2. Many more market instruments across **multiple stock exchanges**
      (London VUAG/VWRP/VUKE/ISF/…, plus US/EU listings), each carrying its
      native currency and exchange; the lookup/verify step shows both, and a
      new `GET /api/market/instruments` powers symbol autocomplete.
- [x] 3. Currency that actually converts: a rough static FX table (`lib/fx.ts`).
      Changing the currency setting re-denominates all stored values (valuations,
      snapshots, fixed schedules) at the latest rate, and any value pulled from a
      market/valuation source in a foreign currency is converted to the user's
      currency before it is stored or used.
- [x] 4. A total figure at the top of the Assets and Liabilities pages.

## Feature batch (2026-06-17 #2)
Implemented strictly in order; one commit per feature.
- [x] 1. Move the Assets/Liabilities page total figure up next to the heading
      (right of it), removing the separate card.
- [x] 2. Investments: show the current market price on the add-asset form once
      the symbol is verified, and a per-investment price indicator in the
      existing gold badge on the holdings page.
- [x] 3. A gold-accented badge next to an asset/liability when a recurring
      increase/decrease applies to it, summarising the schedule (direction,
      amount/percent, cadence, name).

## Feature batch (2026-06-17 #3)
Implemented strictly in order; one commit per feature.
- [x] 1. Holding detail charts: clicking an existing asset/liability generates,
      on the fly, a **line graph** of that holding's value over time (right of the
      edit section) and a **pie graph** (left) showing it as a highlighted slice
      of net worth — the selected holding in gold, other assets in green, other
      liabilities in red. The line graph mirrors the dashboard graph (look +
      range quick-buttons) and gains a **prediction mode** and a **"view as"**
      mode; the pie re-computes for the view-as date (and prediction). Mode
      buttons sit under the middle (edit) section, and the pie has a colour key.
      New endpoints: `GET /api/:kind/:id/{history,prediction,composition}`.
- [x] 2. Home two-level pie: inner ring = Assets (green) vs Liabilities (red);
      outer ring = each individual asset/liability in a unique pastel, aligned to
      its inner half. Full-screen on click. The inner ring has a key; the outer
      ring does not.
- [x] 3. All pie charts have hover capability (tooltip + slice highlight).

## Feature batch (2026-06-22)
Implemented strictly in order; one commit per feature.
- [ ] 1. Inflation-adjusted "real" net worth toggle on the home page: over long
      ranges nominal growth overstates real progress, so a toggle expresses the
      net-worth graph and the dashboard percent changes in today's money
      (a rough static annual-inflation table, like the FX/property tables).
- [ ] 2. Structured logging + request IDs (pino): a real JSON logger replaces the
      ad-hoc console output, every request carries an `x-request-id` (generated
      or propagated) and a one-line completion log (method, path, status,
      duration, user) that never includes financial data — so self-hosters can
      actually diagnose issues alongside `/health/detailed`.
- [ ] 3. Publish SECURITY.md: graduate the security posture already documented
      across ARCHITECTURE/README into a single published security page
      (reporting, posture, hardening guidance, known limitations).
- [ ] 4. Legal/trust pages: a "not financial advice" disclaimer on the sign-up
      page and in a new Settings → Legal section.

## Bug fixes (2026-06-13)
- [x] 1. View-as scrubber: the circle handle, though aligned along the chart's
      X axis, overlapped the date labels. The X-axis band now reserves a label
      row plus a handle lane; the date labels are pushed down (taller XAxis
      `height` + `tickMargin`) so the handle rides ~5px above them. The handle
      diameter is fixed in CSS (`.scrubber`) so the lane is deterministic;
      offsets were tuned against the measured SVG tick positions.
- [x] 2. Prediction mode: only the hover tooltip showed projected figures — the
      surrounding numbers (net worth / assets / liabilities totals, their
      category breakdowns, and every percentage) stayed at today's live values.
      Now every dashboard number reflects the projection while prediction mode
      is on: `summary`/`changes` take a `predict` flag and the server projects
      the portfolio forward (`projectPortfolioAt`) to the range's horizon by
      default — or to the view-as date when scrubbed; percentages become
      projected growth vs today, captioned "projected".

