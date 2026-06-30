import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { HISTORY_RANGES, isHistoryRange } from '../../lib/dates.js';
import { audit } from '../../lib/audit.js';
import { badRequest, idParam, parseBody } from '../../lib/http.js';
import {
  acceptLink, combinedHistory, combinedTotals, declineLink, getLinkStatus, inviteByUsername, unlink,
} from './service.js';

const inviteSchema = z.object({ username: z.string().trim().min(1).max(80) });

export function householdRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json(getLinkStatus(ctx, req.user!.id));
  });

  router.post('/invite', (req, res) => {
    const { username } = parseBody(inviteSchema, req.body);
    const dto = inviteByUsername(ctx, req.user!.id, username);
    audit(ctx.db, { userId: req.user!.id, action: 'household.invite', detail: { username }, ip: req.ip });
    res.status(201).json(dto);
  });

  router.post('/:id/accept', (req, res) => {
    const id = idParam(req);
    const dto = acceptLink(ctx, req.user!.id, id);
    audit(ctx.db, {
      userId: req.user!.id, action: 'household.accept', entityType: 'household_link', entityId: id, ip: req.ip,
    });
    res.json(dto);
  });

  router.post('/:id/decline', (req, res) => {
    const id = idParam(req);
    declineLink(ctx, req.user!.id, id);
    audit(ctx.db, {
      userId: req.user!.id, action: 'household.decline', entityType: 'household_link', entityId: id, ip: req.ip,
    });
    res.status(204).end();
  });

  router.delete('/:id', (req, res) => {
    const id = idParam(req);
    unlink(ctx, req.user!.id, id);
    audit(ctx.db, {
      userId: req.user!.id, action: 'household.unlink', entityType: 'household_link', entityId: id, ip: req.ip,
    });
    res.status(204).end();
  });

  router.get('/combined/summary', async (req, res) => {
    res.json(await combinedTotals(ctx, req.user!.id));
  });

  router.get('/combined/history', async (req, res) => {
    const range = String(req.query.range ?? 'ALL').toUpperCase();
    if (!isHistoryRange(range)) throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    res.json(await combinedHistory(ctx, req.user!.id, range));
  });

  return router;
}
