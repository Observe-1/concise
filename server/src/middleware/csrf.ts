import type { Request, RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import { forbidden } from '../lib/http.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for a SPA with SameSite=Lax session cookies: mutating requests
 * must carry an Origin (or Referer) we trust. An origin is trusted when it is:
 *   1. same-origin — Origin host matches the request Host (production: the SPA
 *      is served by this backend), or
 *   2. explicitly configured via TRUSTED_ORIGINS (e.g. a separately hosted
 *      frontend), or
 *   3. a loopback origin outside production — in development the Vite dev
 *      server proxies /api, so the browser's Origin (localhost:<vite port>)
 *      differs from the backend Host (localhost:3000).
 * Cross-site form posts and scripted requests from other origins fail this.
 */
export function csrfProtection(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const source = req.headers.origin ?? req.headers.referer;
    if (!source) throw forbidden('Missing Origin header');
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw forbidden('Invalid Origin header');
    }
    if (isTrustedOrigin(url, req, ctx)) return next();
    throw forbidden('Cross-origin request rejected');
  };
}

function isTrustedOrigin(url: URL, req: Request, ctx: AppContext): boolean {
  if (url.host === req.headers.host) return true;
  if (ctx.config.trustedOrigins.includes(url.origin)) return true;
  if (ctx.config.env !== 'production' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return true;
  }
  return false;
}
