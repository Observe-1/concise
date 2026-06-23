# Security

Concise is a **self-hosted** personal finance tracker: you run the process and
own the database, so you are the operator and the data controller. This page
describes how to report a vulnerability, the security posture that is built into
the app, how to deploy it safely, and the things it deliberately does **not** do.

The posture below is the security model already described throughout
[ARCHITECTURE.md](ARCHITECTURE.md) (§4 Auth/CSRF, §3 Data model, §6/§7),
[HEALTHCHECK.md](HEALTHCHECK.md) and [BACKUP.md](BACKUP.md) — consolidated here
as the single page to read first.

## Reporting a vulnerability

**Please report security issues privately — do not open a public issue, PR or
discussion for a suspected vulnerability.**

- Preferred: open a private report via the repository's
  **Security → Advisories → "Report a vulnerability"** (GitHub private security
  advisories). If that is unavailable on your fork, contact the maintainer
  privately instead of filing publicly.
- Include: affected version/commit, a description of the issue and its impact, and
  the minimal steps (or a small proof of concept) needed to reproduce it.
- Please give a reasonable window to investigate and ship a fix before any public
  disclosure. We aim to acknowledge a report within a few days.

Because every instance is self-hosted, **the most important mitigation is to run
a recent version and apply updates** — there is no central service to patch on
your behalf.

## Supported versions

This is a small project with a single active line of development: security fixes
land on the latest `main` / newest release. Run the latest version; older
checkouts are not separately patched.

## Security posture

What the application enforces by design (all of this is in the codebase and
exercised by the security test suite, `server/test/integration/security.test.ts`):

### Authentication & sessions
- Passwords are hashed with **scrypt** (`node:crypto`); verification uses
  `timingSafeEqual`, and a **dummy hash is verified for unknown usernames** so
  login timing does not reveal whether an account exists.
- Sessions are **opaque random tokens**; only their **SHA-256 hash** is stored,
  so a leaked database does not hand over usable session tokens. Sessions are
  server-side and **revocable**, expire (sliding TTL, `SESSION_TTL_HOURS`), and
  are purged when expired.
- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production
  (`COOKIE_SECURE`). No tokens are stored in client-side JavaScript storage.
- Self-service registration and login are **rate-limited** (see below).

### Authorization & data isolation
- Every request to a data route requires a valid session (`requireAuth`).
- **All data is scoped by `user_id`**; every query filters on it, and per-entity
  routes verify ownership (e.g. `assertHoldingOwned` → `404`), so one user can
  never read or mutate another's holdings, history or settings.

### Input validation & database safety
- Every request body is validated with **zod** schemas before use; the JSON body
  is capped at **100 kB**.
- There is **no ORM**: all SQL is hand-written **parameterised** prepared
  statements (`node:sqlite`), so user input is never concatenated into SQL —
  closing off SQL injection. Money is stored as **integer minor units**, never
  floats.

### CSRF
- Mutating requests (`POST`/`PATCH`/`DELETE`) must carry an `Origin`/`Referer`
  that is trusted — same-origin as the request `Host`, an entry in
  `TRUSTED_ORIGINS`, or a loopback origin outside production (for the Vite dev
  proxy). Combined with the `SameSite=Lax` cookie this blocks cross-site
  request forgery.

### Rate limiting
- Login/registration: **10 attempts per IP per 15 minutes** (`LOGIN_RATE_LIMIT`).
- General API: **300 requests per IP per minute** (`API_RATE_LIMIT`).
- Behind a reverse proxy, set `TRUST_PROXY` so limits key on the real client IP.

### HTTP hardening
- **helmet** sets a strict **Content-Security-Policy** (`default-src 'self'`,
  no framing — `frame-ancestors 'none'`, etc.) and related headers; the
  `X-Powered-By` header is removed.

### Auditing & logging
- An **audit log** persists authentication events and every mutation with the
  client IP (`audit_log` table).
- **Operational logs** are structured JSON with a per-request correlation id
  (`x-request-id`); they record method, path, status, timing, the client IP (as
  in the audit log) and the user id — and **never** request bodies, financial
  figures, passwords or session tokens (cookie/authorization headers are redacted
  defensively). See ARCHITECTURE §7.
- The **health endpoints** (`/api/health`, `/api/health/detailed`) are
  unauthenticated by design and report only operational status — never any
  financial or account data ([HEALTHCHECK.md](HEALTHCHECK.md)).

### Data at rest & backups
- State is a single **SQLite** file you control. Backups are **validated**
  point-in-time copies (checkpoint → copy → `integrity_check`) written to
  `BACKUP_DIR`; the contents are as sensitive as the database itself
  ([BACKUP.md](BACKUP.md)).

## Deploying securely

A hardening checklist for self-hosters (see [README](README.md#running-in-production)):

- **Serve over HTTPS.** Put Concise behind a TLS-terminating reverse proxy
  (Caddy, nginx, Traefik). Keep `COOKIE_SECURE=true` (the production default) —
  over plain HTTP the session cookie is not sent and login silently fails, which
  is the safe failure.
- **Set `TRUST_PROXY`** to the number of proxy hops so client IPs (rate limiting,
  audit log) are correct, and **`TRUSTED_ORIGINS`** if the SPA is served from a
  different origin than the API.
- **Run as a non-root user.** The provided Docker image already does.
- **Protect the database and backups.** Restrict filesystem permissions on
  `DB_PATH` and `BACKUP_DIR`, keep them on a volume you trust, and copy backups
  off-host. Consider full-disk / volume encryption for at-rest protection.
- **Keep secrets in the environment**, not in the image or version control;
  configuration is env-only (`config.ts`).
- **Keep Node.js and dependencies up to date** and redeploy to pick up fixes.
- Use the structured logs (`LOG_LEVEL`) and `/api/health/detailed` to monitor the
  instance.

## Known limitations & non-goals

Concise is intentionally small and single-tenant-friendly. It does **not**
currently provide:

- **Multi-factor authentication (MFA/2FA)** or SSO.
- **Built-in encryption at rest** — rely on disk/volume encryption and file
  permissions for the SQLite database and backups.
- A **password-reset / email** flow — there is no email integration; an operator
  manages accounts directly.
- **Hardened multi-tenant isolation guarantees** beyond per-`user_id` scoping —
  it suits a small, trusted set of users (e.g. a household), not an untrusted
  public sign-up service at scale.
- **Authoritative financial data.** Exchange rates, market prices, property and
  vehicle valuation models, and the inflation series used by the "real terms"
  toggle are **rough, approximate static tables**, not a market data feed. Figures
  are for personal record-keeping and are **not financial advice** (see the
  in-app disclaimer on sign-up and in Settings → Legal).

If a feature here matters for your threat model, run Concise behind
infrastructure that provides it (e.g. an authenticating proxy for MFA, an
encrypted volume for at-rest encryption).
