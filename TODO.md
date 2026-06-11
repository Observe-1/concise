# TODO — single source of truth for progress

**Current phase: 3 — Backend API**

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
- [ ] App factory with DI (db, clock, price provider), error handling, validation
- [ ] Auth module (login/logout/me, scrypt, sessions, cookies)
- [ ] Assets module (CRUD + valuations)
- [ ] Liabilities module (CRUD + valuations)
- [ ] Recurring transactions module + engine (catch-up, cadence advance)
- [ ] Snapshots (daily upsert + on-mutation refresh)
- [ ] Market valuation module (provider interface + simulated provider + refresh)
- [ ] Dashboard aggregation (summary + history ranges)
- [ ] Settings module
- [ ] Job scheduler (in-process tick)
- [ ] Unit tests (money, dates, cadence, services)
- [ ] Integration tests (API + in-memory DB) — 80% coverage target
- [ ] Security tests (auth bypass, injection, rate limiting)

## Phase 4: Frontend application
- [ ] Vite + React + Tailwind scaffold, black/gold theme tokens
- [ ] API client + TanStack Query setup
- [ ] Login page
- [ ] App shell (mobile bottom nav / desktop rail)
- [ ] Dashboard (summary cards, interactive graph, range presets, full-screen)
- [ ] Assets page (grouped by class, add/edit/delete, value updates)
- [ ] Liabilities page
- [ ] Recurring management UI
- [ ] Settings page (profile, currency)
- [ ] Component + integration tests, accessibility, responsive checks

## Phase 5: Authentication & security
- [ ] Rate limiting (login + API)
- [ ] CSRF protection (origin check)
- [ ] Security headers (helmet)
- [ ] Audit logging wired to all mutations
- [ ] Security test suite (bypass, injection, authz boundaries)

## Phase 6: Quality assurance
- [ ] Playwright e2e: login → asset → liability → recurring → net worth → graph
- [ ] Regression suite wiring
- [ ] Performance checks (API latency, UI render)

## Phase 7: Deployment
- [ ] Dockerfile + compose (volume for SQLite)
- [ ] GitHub Actions CI (lint, typecheck, tests, build)
- [ ] Env configuration + production hardening
- [ ] Backup strategy + runbooks (deploy/)
