# TODO — single source of truth for progress

**Current phase: 7 — Deployment**

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

## Phase 7: Deployment
- [ ] Dockerfile + compose (volume for SQLite)
- [ ] GitHub Actions CI (lint, typecheck, tests, build)
- [ ] Env configuration + production hardening
- [ ] Backup strategy + runbooks (deploy/)
