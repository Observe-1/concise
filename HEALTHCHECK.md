# Concise — Health checking

> Code is the source of truth. This document describes the health endpoints as
> implemented. See [ARCHITECTURE.md](ARCHITECTURE.md) for the wider system.

Concise exposes two **unauthenticated** health endpoints under `/api/health`.
They are designed for container orchestrators (Docker's `HEALTHCHECK`), reverse
proxies, and self-hosted monitors — the kind of tooling an [unraid](https://unraid.net)
or home-lab user already runs (Uptime Kuma, healthchecks.io, the unraid Docker
tab's built-in health dot).

There are two, by design — a tiny *liveness* probe and a richer *readiness*
probe:

| Endpoint | Question it answers | Audience |
|----------|---------------------|----------|
| `GET /api/health` | "Is the process alive and answering?" | Docker `HEALTHCHECK`, load balancers, quick `curl` |
| `GET /api/health/detailed` | "Are the UI, server and database all actually working?" | Dashboards, on-call debugging, deeper monitors |

## Privacy guarantee — no financial data, ever

**Neither endpoint reports any financial information.** No net worth, no asset or
liability values, no amounts, no currencies, no per-user counts, no account
details, and no secrets. They report *operational* status only (up/down,
latency, version, uptime). Both are public precisely because they can be — there
is nothing sensitive in either response. Keep it that way: anything added here
must stay non-financial and non-sensitive.

## 1. Simple endpoint — `GET /api/health` (liveness / "UP or NOT")

The smallest possible "am I up?" check. If the Node process is running and able
to answer HTTP, it returns:

```http
GET /api/health  →  200 OK
{ "ok": true }
```

"NOT" is the absence of that 200: a refused connection, a timeout, or no
response means the process is down. The probe runs no database query and touches
no application state, so it stays fast and cannot itself be the thing that fails.
This is pure **liveness** — "should this container be considered alive?" — which
is why it is the one wired into the container's `HEALTHCHECK` (see below): a
transient database hiccup must **not** make Docker restart-loop a process that is
otherwise perfectly alive.

## 2. Detailed endpoint — `GET /api/health/detailed` (readiness)

A structured **readiness** check that probes the three things a Concise
deployment depends on — the **UI**, the **server**, and the **database**:

```http
GET /api/health/detailed  →  200 OK
{
  "status": "ok",                       // ok | degraded | down
  "version": "0.1.0",                   // app (server) version, best-effort
  "uptimeSeconds": 4096,
  "timestamp": "2026-06-15T12:00:00.000Z",
  "runtime": {
    "node": "v24.16.0",                 // Node.js version
    "sqlite": "3.53.0",                 // bundled SQLite library version
    "platform": "linux",               // OS platform
    "arch": "x64",                     // CPU architecture (x64 / arm64)
    "environment": "production",        // config profile
    "pid": 1,                           // process id (for log correlation)
    "memoryRssMb": 78.2,                // whole-process memory (RSS)
    "memoryHeapUsedMb": 21.4            // V8 heap in use
  },
  "network": {
    "port": 3000                        // HTTP port the API + SPA are served on
  },
  "checks": {
    "server":   { "status": "up", "detail": "process responding" },
    "database": { "status": "up", "detail": "reachable", "latencyMs": 0.4 },
    "ui":       { "status": "up", "detail": "static frontend bundle present" }
  }
}
```

### Runtime diagnostics

The `runtime` and `network` blocks are non-pass/fail diagnostics — the things
you actually want when something looks off on a self-hosted box: the **Node** and
**SQLite** versions in play, the **platform/arch** (handy on ARM unraid/NAS
hardware), which **environment** profile is running, the **pid** for correlating
container logs, current **memory** use, and the **port** the process is serving
on. All of it is non-sensitive and non-financial.

### What each check means

- **server** — the API layer is responding. If you received the JSON at all,
  this is `up`; it exists so dashboards have one row per component.
- **database** — runs a trivial `SELECT 1` against the SQLite file and times it.
  `up` with a `latencyMs`, or `down` if the query throws (locked/missing/corrupt
  file). The error text is **not** echoed back (it could leak a file path), only
  a generic `detail`.
- **ui** — can *this process* serve the built single-page app? Concise is one
  process that serves both the API and the static frontend (see
  [ARCHITECTURE.md](ARCHITECTURE.md) §1), so this checks that
  `WEB_DIST_DIR/index.html` exists and is readable.
  - `up` — the bundle is present and servable.
  - `down` — **in production** the bundle is missing (a broken build/deploy).
  - `skipped` — **outside production** the frontend is served by the Vite dev
    server, not this process, so its absence here is expected and ignored.

### Overall status and HTTP code

The top-level `status` rolls the checks up, and the HTTP status code follows it
so dumb monitors (that only look at the code) still do the right thing:

| Condition | `status` | HTTP code |
|-----------|----------|-----------|
| Everything `up`/`skipped` | `ok` | `200` |
| A non-critical check is `down` (e.g. the UI bundle is missing) | `degraded` | `200` |
| The **database** is `down` | `down` | `503` |

The database is the only *critical* dependency: without it the app cannot
function, so its failure returns `503`. A missing UI bundle is `degraded` but
still `200` — the API works, the process is alive, and you do not want a monitor
to trigger a restart loop over a deploy-time mistake. Sophisticated monitors can
key off the `status` field; simple ones can key off the HTTP code.

## Using it on unraid / in a container

- **Container `HEALTHCHECK`.** The [Dockerfile](Dockerfile) and
  [docker-compose.yml](docker-compose.yml) poll `GET /api/health` with Node's
  global `fetch` (no `curl` in the slim image). unraid surfaces the result as
  the health dot next to the container in its Docker tab — green once the
  liveness probe passes.
- **External monitors** (Uptime Kuma, healthchecks.io, Gatus, …). Point them at
  `GET /api/health` for a binary up/down, or at `GET /api/health/detailed` to
  alert on `503` (database down) and to graph `database.latencyMs` over time.
- **No auth required.** Both endpoints are mounted before the auth middleware so
  probes need no session. They are safe to expose because they carry no
  sensitive data (see the privacy guarantee above) — though you may still prefer
  to keep `/api` behind your reverse proxy / LAN.

## Where it lives in the code

- Routes: [server/src/modules/health/routes.ts](server/src/modules/health/routes.ts)
- Mounted (public, before auth) in [server/src/app.ts](server/src/app.ts)
- DTOs: `HealthDto` / `DetailedHealthDto` in [server/src/types/api.ts](server/src/types/api.ts)
- Tests: [server/test/integration/health.test.ts](server/test/integration/health.test.ts)
