import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { idParam, parseBody } from '../../lib/http.js';
import { createGoal, deleteGoal, getGoal, listGoals, updateGoal } from './service.js';

const MAX_TARGET_MINOR = 1_000_000_000_000_000;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine(
  (s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)),
  'Invalid date',
);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  goalType: z.enum(['net_worth', 'liability_payoff']).default('net_worth'),
  targetMinor: z.number().int().positive().max(MAX_TARGET_MINOR).optional(),
  liabilityId: z.number().int().positive().optional(),
  targetDate: dateSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine(
  (d) => (d.goalType === 'net_worth' && d.targetMinor !== undefined && d.liabilityId === undefined)
    || (d.goalType === 'liability_payoff' && d.liabilityId !== undefined && d.targetMinor === undefined),
  { message: 'A net-worth goal needs targetMinor; a payoff goal needs liabilityId (not both)' },
);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  targetMinor: z.number().int().positive().max(MAX_TARGET_MINOR).optional(),
  targetDate: dateSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export function goalsRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(listGoals(ctx, req.user!.id));
  });

  router.get('/:id', (req, res) => {
    res.json(getGoal(ctx, req.user!.id, idParam(req)));
  });

  router.post('/', (req, res) => {
    const dto = createGoal(ctx, req.user!.id, parseBody(createSchema, req.body));
    audit(ctx.db, { userId: req.user!.id, action: 'goals.create', entityType: 'goal', entityId: dto.id, ip: req.ip });
    res.status(201).json(dto);
  });

  router.patch('/:id', (req, res) => {
    const dto = updateGoal(ctx, req.user!.id, idParam(req), parseBody(updateSchema, req.body));
    audit(ctx.db, { userId: req.user!.id, action: 'goals.update', entityType: 'goal', entityId: dto.id, ip: req.ip });
    res.json(dto);
  });

  router.delete('/:id', (req, res) => {
    const id = idParam(req);
    deleteGoal(ctx, req.user!.id, id);
    audit(ctx.db, { userId: req.user!.id, action: 'goals.delete', entityType: 'goal', entityId: id, ip: req.ip });
    res.status(204).end();
  });

  return router;
}
