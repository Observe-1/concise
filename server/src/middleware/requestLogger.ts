import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import type { Logger } from '../lib/logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accept an inbound request id only if it is a short, safe token. This both
 * keeps logs/headers clean and avoids reflecting attacker-controlled bytes
 * (newlines, control chars) into the response header — anything else is
 * replaced with a freshly generated id.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,200}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request (echoed in the x-request-id header). */
      id?: string;
      /** Per-request child logger pre-tagged with the request id. */
      log?: Logger;
    }
  }
}

/**
 * Per-request correlation id + structured access log. Mounted first on the API
 * router so every `/api/*` request (including rate-limited 429s and errors) gets:
 *  - a request id, taken from an inbound `x-request-id` header (so a reverse
 *    proxy's id is preserved) or freshly generated, echoed back on the response;
 *  - `req.log`, a child logger tagged with that id, used by the error handler
 *    and available to routes;
 *  - one "request completed" line on response finish with method, path (no
 *    query string), status, duration and the authenticated user id — never any
 *    request body or financial data.
 *
 * Liveness (`/api/health`) is logged at `debug` because container health checks
 * poll it constantly; everything else is `info`.
 */
export function requestLogger(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const provided = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = provided && SAFE_REQUEST_ID.test(provided) ? provided : randomUUID();
    req.id = requestId;
    req.log = ctx.log.child({ requestId });
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startNs = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - startNs) / 1e4) / 100;
      const path = req.originalUrl.split('?')[0]; // drop the query string
      const level = path === '/api/health' ? 'debug' : 'info';
      req.log![level](
        {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs,
          userId: req.user?.id ?? null,
          ip: req.ip,
        },
        'request completed',
      );
    });

    next();
  };
}
