import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { METALS } from '../../types/api.js';
import type { HoldingKind } from './kind.js';
import { audit } from '../../lib/audit.js';
import { badRequest, idParam, parseBody } from '../../lib/http.js';
import {
  addValuation, createHolding, deleteHolding, getHolding, listHoldings, updateHolding,
} from './service.js';

const MAX_MINOR = 1_000_000_000_000_000; // 10^15 — far below Number.MAX_SAFE_INTEGER

const valueSchema = z.number().int().min(0).max(MAX_MINOR);

function buildSchemas(k: HoldingKind) {
  const base = {
    category: z.enum(k.categories as [string, ...string[]]),
    name: z.string().trim().min(1).max(120),
    notes: z.string().max(2000).nullable().optional(),
  };
  const market = k.supportsMarket
    ? {
        metal: z.enum(METALS).nullable().optional(),
        valuationMode: z.enum(['manual', 'market']).optional(),
        marketSymbol: z.string().trim().min(1).max(20).optional(),
        quantity: z.number().positive().finite().optional(),
      }
    : {};
  // metal only makes sense on the precious_metals class (DB CHECK mirrors this)
  const create = z.object({ ...base, ...market, valueMinor: valueSchema.optional() })
    .refine((data) => {
      const d = data as { category?: string; metal?: string | null };
      return !d.metal || d.category === 'precious_metals';
    }, { message: 'metal requires the precious_metals category', path: ['metal'] });
  const update = z.object({
    category: base.category.optional(),
    name: base.name.optional(),
    notes: base.notes,
    ...(k.supportsMarket
      ? {
          metal: z.enum(METALS).nullable().optional(),
          valuationMode: z.enum(['manual', 'market']).optional(),
          marketSymbol: z.string().trim().min(1).max(20).nullable().optional(),
          quantity: z.number().positive().finite().nullable().optional(),
        }
      : {}),
  });
  return { create, update };
}

export function holdingsRoutes(ctx: AppContext, k: HoldingKind): Router {
  const router = Router();
  const schemas = buildSchemas(k);

  router.get('/', (req, res) => {
    res.json(listHoldings(ctx, k, req.user!.id));
  });

  router.post('/', (req, res) => {
    const input = parseBody(schemas.create, req.body) as Record<string, unknown> & {
      valuationMode?: string; marketSymbol?: string; quantity?: number; valueMinor?: number;
    };
    if (input.valuationMode === 'market') {
      if (!input.marketSymbol || !input.quantity) {
        throw badRequest('marketSymbol and quantity are required for market-valued entries');
      }
    } else if (input.valueMinor === undefined) {
      throw badRequest('valueMinor is required for manually valued entries');
    }
    const dto = createHolding(ctx, k, req.user!.id, input as never);
    audit(ctx.db, {
      userId: req.user!.id, action: `${k.kind}.create`, entityType: k.kind, entityId: dto.id, ip: req.ip,
    });
    res.status(201).json(dto);
  });

  router.get('/:id', (req, res) => {
    res.json(getHolding(ctx, k, req.user!.id, idParam(req)));
  });

  router.patch('/:id', (req, res) => {
    const patch = parseBody(schemas.update, req.body);
    const dto = updateHolding(ctx, k, req.user!.id, idParam(req), patch as never);
    audit(ctx.db, {
      userId: req.user!.id, action: `${k.kind}.update`, entityType: k.kind, entityId: dto.id, ip: req.ip,
    });
    res.json(dto);
  });

  router.delete('/:id', (req, res) => {
    const id = idParam(req);
    deleteHolding(ctx, k, req.user!.id, id);
    audit(ctx.db, {
      userId: req.user!.id, action: `${k.kind}.delete`, entityType: k.kind, entityId: id, ip: req.ip,
    });
    res.status(204).end();
  });

  router.get('/:id/valuations', (req, res) => {
    res.json(getHolding(ctx, k, req.user!.id, idParam(req)).valuations);
  });

  router.post('/:id/valuations', (req, res) => {
    const { valueMinor } = parseBody(z.object({ valueMinor: valueSchema }), req.body);
    const id = idParam(req);
    const dto = addValuation(ctx, k, req.user!.id, id, valueMinor);
    audit(ctx.db, {
      userId: req.user!.id, action: `${k.kind}.revalue`, entityType: k.kind, entityId: id,
      detail: { valueMinor }, ip: req.ip,
    });
    res.status(201).json(dto);
  });

  return router;
}
