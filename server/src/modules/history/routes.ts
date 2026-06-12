import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound, parseBody } from '../../lib/http.js';
import { MAX_MINOR, dateStringSchema } from '../../lib/schemas.js';
import { deleteLegacyWealth, listLegacyWealth, setLegacyWealth } from './service.js';

const legacySchema = z.object({
  date: dateStringSchema,
  netWorthMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR),
});

export function historyRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/legacy', (req, res) => {
    res.json(listLegacyWealth(ctx, req.user!.id));
  });

  router.post('/legacy', (req, res) => {
    const { date, netWorthMinor } = parseBody(legacySchema, req.body);
    const dto = setLegacyWealth(ctx, req.user!.id, date, netWorthMinor);
    audit(ctx.db, {
      userId: req.user!.id, action: 'history.legacy_set', detail: dto, ip: req.ip,
    });
    res.status(201).json(dto);
  });

  router.delete('/legacy/:date', (req, res) => {
    const date = dateStringSchema.safeParse(req.params.date);
    if (!date.success) throw badRequest('Invalid date');
    if (!deleteLegacyWealth(ctx, req.user!.id, date.data)) {
      throw notFound('No legacy wealth entry on that date');
    }
    audit(ctx.db, {
      userId: req.user!.id, action: 'history.legacy_delete', detail: { date: date.data }, ip: req.ip,
    });
    res.status(204).end();
  });

  return router;
}
