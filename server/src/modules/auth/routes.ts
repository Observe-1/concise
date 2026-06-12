import { Router, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { HttpError, parseBody, readCookie, unauthorized } from '../../lib/http.js';
import { SESSION_COOKIE } from '../../middleware/auth.js';
import { login, logout, register, type LoginResult } from './service.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Use letters, numbers, dots, dashes or underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: ctx.config.loginRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many login attempts; try again later' }),
  });

  const setSessionCookie = (res: Response, result: LoginResult) => {
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.cookieSecure,
      path: '/',
      expires: new Date(result.expiresAt),
    });
  };

  router.post('/login', loginLimiter, (req, res) => {
    const { username, password } = parseBody(loginSchema, req.body);
    const result = login(ctx, username, password);
    if (!result) {
      audit(ctx.db, { userId: null, action: 'auth.login_failed', detail: { username }, ip: req.ip });
      throw unauthorized('Invalid username or password');
    }
    audit(ctx.db, { userId: result.user.id, action: 'auth.login', ip: req.ip });
    setSessionCookie(res, result);
    res.json({ user: result.user });
  });

  router.post('/register', loginLimiter, (req, res) => {
    const input = parseBody(registerSchema, req.body);
    const result = register(ctx, input);
    if (!result) {
      audit(ctx.db, { userId: null, action: 'auth.register_failed', detail: { username: input.username }, ip: req.ip });
      throw new HttpError(409, 'That username is already taken');
    }
    audit(ctx.db, { userId: result.user.id, action: 'auth.register', ip: req.ip });
    setSessionCookie(res, result);
    res.status(201).json({ user: result.user });
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
