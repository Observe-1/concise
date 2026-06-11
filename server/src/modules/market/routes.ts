import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/http.js';
import { refreshMarketValuations } from './service.js';

export function marketRoutes(ctx: AppContext): Router {
  const router = Router();

  // Resolve a ticker to its instrument name (asset-creation verification step).
  router.get('/lookup', (req, res) => {
    const symbol = String(req.query.symbol ?? '').trim();
    if (!symbol || symbol.length > 20) throw badRequest('symbol query parameter required');
    const result = ctx.prices.lookupSymbol(symbol);
    if (!result) throw notFound(`Unknown symbol: ${symbol.toUpperCase()}`);
    res.json(result);
  });

  router.post('/refresh', (req, res) => {
    const updated = refreshMarketValuations(ctx, req.user!.id);
    audit(ctx.db, {
      userId: req.user!.id, action: 'market.refresh', detail: { updated }, ip: req.ip,
    });
    res.json({ updated });
  });

  return router;
}
