import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { idParam, parseBody } from '../../lib/http.js';
import {
  createRecurring, deleteRecurring, getRecurring, listRecurring, updateRecurring,
} from './service.js';

const MAX_MINOR = 1_000_000_000_000_000;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine(
  (s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)),
  'Invalid date',
);
const amountSchema = z.number().int().min(-MAX_MINOR).max(MAX_MINOR).refine((n) => n !== 0, 'Amount cannot be zero');
// Percent of the target's current value per occurrence. -100 empties the
// target; growth is capped at a (generous) +1000% per occurrence.
const percentSchema = z.number().finite().min(-100).max(1000).refine((n) => n !== 0, 'Percent cannot be zero');
const cadenceSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetType: z.enum(['asset', 'liability']),
  targetId: z.number().int().positive(),
  amountMinor: amountSchema.optional(),
  percent: percentSchema.optional(),
  cadence: cadenceSchema,
  nextRunOn: dateSchema,
}).refine(
  (d) => (d.amountMinor !== undefined) !== (d.percent !== undefined),
  { message: 'Provide exactly one of amountMinor or percent' },
);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  amountMinor: amountSchema.optional(),
  percent: percentSchema.optional(),
  cadence: cadenceSchema.optional(),
  nextRunOn: dateSchema.optional(),
  active: z.boolean().optional(),
}).refine(
  (d) => d.amountMinor === undefined || d.percent === undefined,
  { message: 'Provide at most one of amountMinor or percent' },
);

export function recurringRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(listRecurring(ctx, req.user!.id));
  });

  router.post('/', (req, res) => {
    const dto = createRecurring(ctx, req.user!.id, parseBody(createSchema, req.body));
    audit(ctx.db, {
      userId: req.user!.id, action: 'recurring.create', entityType: 'recurring', entityId: dto.id, ip: req.ip,
    });
    res.status(201).json(dto);
  });

  router.get('/:id', (req, res) => {
    res.json(getRecurring(ctx, req.user!.id, idParam(req)));
  });

  router.patch('/:id', (req, res) => {
    const dto = updateRecurring(ctx, req.user!.id, idParam(req), parseBody(updateSchema, req.body));
    audit(ctx.db, {
      userId: req.user!.id, action: 'recurring.update', entityType: 'recurring', entityId: dto.id, ip: req.ip,
    });
    res.json(dto);
  });

  router.delete('/:id', (req, res) => {
    const id = idParam(req);
    deleteRecurring(ctx, req.user!.id, id);
    audit(ctx.db, {
      userId: req.user!.id, action: 'recurring.delete', entityType: 'recurring', entityId: id, ip: req.ip,
    });
    res.status(204).end();
  });

  return router;
}
