import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { parseBody, readCookie, unauthorized } from '../../lib/http.js';
import { SESSION_COOKIE } from '../../middleware/auth.js';
import { login, logout } from './service.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: ctx.config.env === 'test' ? 1000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many login attempts; try again later' }),
  });

  router.post('/login', loginLimiter, (req, res) => {
    const { username, password } = parseBody(loginSchema, req.body);
    const result = login(ctx, username, password);
    if (!result) {
      audit(ctx.db, { userId: null, action: 'auth.login_failed', detail: { username }, ip: req.ip });
      throw unauthorized('Invalid username or password');
    }
    audit(ctx.db, { userId: result.user.id, action: 'auth.login', ip: req.ip });
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.cookieSecure,
      path: '/',
      expires: new Date(result.expiresAt),
    });
    res.json({ user: result.user });
  });

  router.post('/logout', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) logout(ctx, token);
    if (req.user) audit(ctx.db, { userId: req.user.id, action: 'auth.logout', ip: req.ip });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    if (!req.user) throw unauthorized();
    res.json({ user: req.user });
  });

  return router;
}
