import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { AppContext } from './context.js';
import { requireAuth, sessionLoader } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { historyRoutes } from './modules/history/routes.js';
import { ASSET_KIND, LIABILITY_KIND } from './modules/holdings/kind.js';
import { holdingsRoutes } from './modules/holdings/routes.js';
import { marketRoutes } from './modules/market/routes.js';
import { recurringRoutes } from './modules/recurring/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';

export function buildApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.trustProxy > 0) app.set('trust proxy', ctx.config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Recharts sets inline SVG styles
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: ctx.config.env === 'test' ? 10_000 : ctx.config.apiRateLimit,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => res.status(429).json({ error: 'Too many requests' }),
    }),
  );
  api.use(express.json({ limit: '100kb' }));
  api.use(csrfProtection(ctx));
  api.use(sessionLoader(ctx));

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use('/auth', authRoutes(ctx));
  api.use('/assets', requireAuth, holdingsRoutes(ctx, ASSET_KIND));
  api.use('/liabilities', requireAuth, holdingsRoutes(ctx, LIABILITY_KIND));
  api.use('/recurring', requireAuth, recurringRoutes(ctx));
  api.use('/dashboard', requireAuth, dashboardRoutes(ctx));
  api.use('/history', requireAuth, historyRoutes(ctx));
  api.use('/market', requireAuth, marketRoutes(ctx));
  api.use('/settings', requireAuth, settingsRoutes(ctx));

  app.use('/api', api);

  // Serve the built frontend in production; SPA fallback for client routes.
  const indexHtml = path.join(ctx.config.webDistDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(ctx.config.webDistDir, { index: 'index.html', maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(indexHtml);
      } else {
        next();
      }
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
