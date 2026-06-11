import type { RequestHandler } from 'express';
import { forbidden } from '../lib/http.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for a same-origin SPA with SameSite=Lax session cookies:
 * mutating requests must present an Origin (or Referer) header whose host
 * matches the Host the request was sent to. Cross-site form posts and
 * scripted requests from other origins fail this check.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const source = req.headers.origin ?? req.headers.referer;
  if (!source) throw forbidden('Missing Origin header');
  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    throw forbidden('Invalid Origin header');
  }
  if (sourceHost !== req.headers.host) throw forbidden('Cross-origin request rejected');
  next();
};
