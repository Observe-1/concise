import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { refreshMarketValuations } from './service.js';

export function marketRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post('/refresh', (req, res) => {
    const updated = refreshMarketValuations(ctx, req.user!.id);
    audit(ctx.db, {
      userId: req.user!.id, action: 'market.refresh', detail: { updated }, ip: req.ip,
    });
    res.json({ updated });
  });

  return router;
}
