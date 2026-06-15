import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../../context.js';
import type {
  DetailedHealthDto, HealthCheck, HealthDto, HealthNetwork, HealthRuntime, HealthStatus,
} from '../../types/api.js';

/**
 * Health endpoints. Both are UNAUTHENTICATED — Docker's HEALTHCHECK, reverse
 * proxies and external monitors call them with no session — and report ONLY
 * operational status. They never expose financial data, account data or
 * secrets. See HEALTHCHECK.md.
 */
export function healthRoutes(ctx: AppContext): Router {
  const router = Router();
  const version = readVersion();

  // Liveness ("UP or NOT"): if the process can answer this, it is alive. Runs
  // no database query and touches no state, so it is fast and cannot itself be
  // the thing that fails. This is the probe wired into the container HEALTHCHECK.
  router.get('/', (_req, res) => {
    res.json({ ok: true } satisfies HealthDto);
  });

  // Readiness: probe the three things a deployment depends on — the server
  // (this layer is responding), the database (a trivial query), and the UI
  // (can this process serve the built SPA). Returns 503 only when the database
  // — the one critical dependency — is down; a missing UI bundle is degraded
  // but still 200 so a monitor will not restart-loop a live process.
  router.get('/detailed', (_req, res) => {
    const checks = {
      server: { status: 'up', detail: 'process responding' } satisfies HealthCheck,
      database: checkDatabase(ctx),
      ui: checkUi(ctx),
    };
    const status = rollUp(checks);
    const body: DetailedHealthDto = {
      status,
      version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: ctx.now().toISOString(),
      runtime: runtimeInfo(ctx),
      network: networkInfo(ctx, checks.ui),
      checks,
    };
    res.status(status === 'down' ? 503 : 200).json(body);
  });

  return router;
}

/** Non-sensitive runtime diagnostics: versions, host and memory. All
 *  non-financial and safe to expose unauthenticated. */
function runtimeInfo(ctx: AppContext): HealthRuntime {
  const mem = process.memoryUsage();
  const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
  return {
    node: process.version,
    sqlite: process.versions.sqlite ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
    environment: ctx.config.env,
    pid: process.pid,
    memoryRssMb: toMb(mem.rss),
    memoryHeapUsedMb: toMb(mem.heapUsed),
  };
}

/** Per-component ports. They are not necessarily the same one:
 *  - server   — the HTTP port Express listens on.
 *  - ui       — shares the server's port when the SPA is served in-process
 *               (production), but is a separate process (the Vite dev server)
 *               in development, whose port this process does not own → null.
 *  - database — embedded SQLite is a local file, so it has no network port. */
function networkInfo(ctx: AppContext, ui: HealthCheck): HealthNetwork {
  const serverServesUi = ui.status === 'up';
  return {
    server: { port: ctx.config.port, detail: 'HTTP API' },
    ui: serverServesUi
      ? { port: ctx.config.port, detail: 'served in-process with the API' }
      : { port: null, detail: 'served by a separate process (dev server)' },
    database: { port: null, detail: 'embedded SQLite (local file, no network port)' },
  };
}

/** Trivial SELECT 1 against SQLite, timed. Never echoes the raw error (it can
 *  contain a file path) — only a generic detail. */
function checkDatabase(ctx: AppContext): HealthCheck {
  const start = performance.now();
  try {
    const row = ctx.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    return row?.ok === 1
      ? { status: 'up', detail: 'reachable', latencyMs }
      : { status: 'down', detail: 'unexpected query result', latencyMs };
  } catch {
    return { status: 'down', detail: 'query failed', latencyMs: Math.round((performance.now() - start) * 100) / 100 };
  }
}

/** Can THIS process serve the built SPA? It serves the static frontend iff
 *  WEB_DIST_DIR/index.html exists (see app.ts). Outside production the frontend
 *  is served by the Vite dev server, so a missing bundle is expected (skipped),
 *  not a failure. */
function checkUi(ctx: AppContext): HealthCheck {
  const indexHtml = path.join(ctx.config.webDistDir, 'index.html');
  try {
    fs.accessSync(indexHtml, fs.constants.R_OK);
    return { status: 'up', detail: 'static frontend bundle present' };
  } catch {
    return ctx.config.env === 'production'
      ? { status: 'down', detail: 'static frontend bundle missing' }
      : { status: 'skipped', detail: 'served by the dev server' };
  }
}

/** Roll component checks up to an overall status. The database is the only
 *  critical dependency (its failure → `down` → 503); any other down check is
 *  `degraded` (still 200). */
function rollUp(checks: { server: HealthCheck; database: HealthCheck; ui: HealthCheck }): HealthStatus {
  if (checks.database.status === 'down') return 'down';
  if (Object.values(checks).some((c) => c.status === 'down')) return 'degraded';
  return 'ok';
}

/** Best-effort server version. The esbuild bundle runs from server/dist/index.js
 *  (server/package.json one level up, copied into the Docker image); in dev the
 *  source sits deeper. Try npm's env var, then both layouts; fall back to
 *  'unknown'. */
function readVersion(): string {
  if (process.env.npm_package_version) return process.env.npm_package_version;
  const candidates = [
    path.join(import.meta.dirname, '..', 'package.json'), // bundle: dist/.. = server/
    path.join(import.meta.dirname, '..', '..', '..', 'package.json'), // dev: src/modules/health/../../.. = server/
  ];
  for (const candidate of candidates) {
    try {
      const v = (JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: unknown }).version;
      if (typeof v === 'string') return v;
    } catch {
      // try the next candidate
    }
  }
  return 'unknown';
}
