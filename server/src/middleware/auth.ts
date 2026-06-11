import type { RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import type { SessionUser } from '../types/api.js';
import { readCookie, unauthorized } from '../lib/http.js';
import { resolveSession } from '../modules/auth/service.js';

export const SESSION_COOKIE = 'concise_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** Attach req.user when a valid session cookie is present. */
export function sessionLoader(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const user = resolveSession(ctx, token);
      if (user) req.user = user;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};
