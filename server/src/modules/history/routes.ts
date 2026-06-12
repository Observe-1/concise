import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound, parseBody } from '../../lib/http.js';
import { idParam } from '../../lib/http.js';
import { MAX_MINOR, dateStringSchema, valueMinorSchema } from '../../lib/schemas.js';
import {
  deleteHistoryEntry, deleteLegacyWealth, listHistoryEntries, listLegacyWealth,
  setLegacyWealth, updateHistoryEntry, type EntrySide,
} from './service.js';

const legacySchema = z.object({
  date: dateStringSchema,
  netWorthMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR),
});

const sideSchema = z.enum(['asset', 'liability']);

const entryPatchSchema = z.object({
  valueMinor: valueMinorSchema.optional(),
  recordedOn: dateStringSchema.optional(),
}).refine((p) => p.valueMinor !== undefined || p.recordedOn !== undefined, {
  message: 'Provide valueMinor and/or recordedOn',
});

export function historyRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/entries', (req, res) => {
    const side = req.query.side !== undefined ? sideSchema.safeParse(req.query.side) : undefined;
    if (side && !side.success) throw badRequest('Invalid side; expected asset or liability');
    const holdingId = req.query.holdingId !== undefined ? Number(req.query.holdingId) : undefined;
    if (holdingId !== undefined && (!Number.isInteger(holdingId) || holdingId <= 0)) {
      throw badRequest('Invalid holdingId');
    }
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    res.json(listHistoryEntries(ctx, req.user!.id, {
      side: side?.data, holdingId, ...(limit !== undefined ? { limit } : {}),
    }));
  });

  const parseSide = (raw: unknown): EntrySide => {
    const parsed = sideSchema.safeParse(raw);
    if (!parsed.success) throw badRequest('Invalid side; expected asset or liability');
    return parsed.data;
  };

  router.patch('/entries/:side/:id', (req, res) => {
    const side = parseSide(req.params.side);
    const id = idParam(req);
    const patch = parseBody(entryPatchSchema, req.body);
    const dto = updateHistoryEntry(ctx, req.user!.id, side, id, patch);
    audit(ctx.db, {
      userId: req.user!.id, action: 'history.entry_update', entityType: `${side}_valuation`,
      entityId: id, detail: patch, ip: req.ip,
    });
    res.json(dto);
  });

  router.delete('/entries/:side/:id', (req, res) => {
    const side = parseSide(req.params.side);
    const id = idParam(req);
    deleteHistoryEntry(ctx, req.user!.id, side, id);
    audit(ctx.db, {
      userId: req.user!.id, action: 'history.entry_delete', entityType: `${side}_valuation`,
      entityId: id, ip: req.ip,
    });
    res.status(204).end();
  });

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
