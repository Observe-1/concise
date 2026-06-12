import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound, parseBody } from '../../lib/http.js';
import { deleteLegacyWealth, listLegacyWealth, setLegacyWealth } from './service.js';

const MAX_MINOR = 1_000_000_000_000_000;

export const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date')
  .refine((s) => s >= '1900-01-01', 'Date too far in the past');

const legacySchema = z.object({
  date: dateSchema,
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
    const date = dateSchema.safeParse(req.params.date);
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
