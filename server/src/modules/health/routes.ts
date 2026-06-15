import { Router } from 'express';
import type { AppContext } from '../../context.js';
import type { HealthDto } from '../../types/api.js';

/**
 * Health endpoints. Both are UNAUTHENTICATED — Docker's HEALTHCHECK, reverse
 * proxies and external monitors call them with no session — and report ONLY
 * operational status. They never expose financial data, account data or
 * secrets. See HEALTHCHECK.md.
 */
export function healthRoutes(_ctx: AppContext): Router {
  const router = Router();

  // Liveness ("UP or NOT"): if the process can answer this, it is alive. Runs
  // no database query and touches no state, so it is fast and cannot itself be
  // the thing that fails. This is the probe wired into the container HEALTHCHECK.
  router.get('/', (_req, res) => {
    res.json({ ok: true } satisfies HealthDto);
  });

  return router;
}
