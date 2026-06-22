import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { METALS } from '../../types/api.js';
import type { HoldingKind } from './kind.js';
import { audit } from '../../lib/audit.js';
import { asOfParam, badRequest, idParam, parseBody } from '../../lib/http.js';
import { addDays, advanceCadence, isHistoryRange, todayISO, HISTORY_RANGES } from '../../lib/dates.js';
import {
  TREND_WINDOW_DEFAULT_DAYS, TREND_WINDOW_MAX_DAYS, TREND_WINDOW_MIN_DAYS,
} from '../../lib/series.js';
import { dateStringSchema, valueMinorSchema as valueSchema } from '../../lib/schemas.js';
import {
  addValuation, assertHoldingOwned, createHolding, deleteHolding, getHolding,
  holdingChanges, holdingHistory, listHoldings, updateHolding,
} from './service.js';
import { createRecurring } from '../recurring/service.js';
import { buildHoldingPrediction } from '../dashboard/prediction.js';
import { holdingComposition } from '../dashboard/composition.js';
import { primeUserMarketPrices } from '../market/service.js';

// Market-return estimates look back ~10 years; warm that window before any
// per-holding projection (a no-op for the simulated provider).
const PREDICTION_LOOKBACK_DAYS = 3660;

function buildSchemas(k: HoldingKind) {
  const base = {
    category: z.enum(k.categories as [string, ...string[]]),
    name: z.string().trim().min(1).max(120),
    notes: z.string().max(2000).nullable().optional(),
  };
  const market = k.supportsMarket
    ? {
        metal: z.enum(METALS).nullable().optional(),
        valuationMode: z.enum(['manual', 'market', 'property_index', 'depreciation']).optional(),
        marketSymbol: z.string().trim().min(1).max(20).optional(),
        quantity: z.number().positive().finite().optional(),
        country: z.string().trim().length(2).optional(),
        manufactureDate: dateStringSchema.optional(),
      }
    : {};
  // Liabilities only: an optional interest rate that auto-creates a yearly
  // percent schedule growing the balance (capped to the recurring engine's
  // per-occurrence ceiling).
  const liabilityExtras = k.supportsMarket
    ? {}
    : { interestRatePct: z.number().finite().gt(0).max(1000).optional() };
  // metal only makes sense on the precious_metals class (DB CHECK mirrors this)
  const create = z.object({
    ...base, ...market, ...liabilityExtras,
    valueMinor: valueSchema.optional(),
    presentValueMinor: valueSchema.optional(),
    asOf: dateStringSchema.optional(),
  })
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
          valuationMode: z.enum(['manual', 'market', 'property_index', 'depreciation']).optional(),
          marketSymbol: z.string().trim().min(1).max(20).nullable().optional(),
          quantity: z.number().positive().finite().nullable().optional(),
          country: z.string().trim().length(2).nullable().optional(),
          manufactureDate: dateStringSchema.nullable().optional(),
        }
      : {}),
  });
  return { create, update };
}

export function holdingsRoutes(ctx: AppContext, k: HoldingKind): Router {
  const router = Router();
  const schemas = buildSchemas(k);

  router.get('/', (req, res) => {
    res.json(listHoldings(ctx, k, req.user!.id, asOfParam(req)));
  });

  // Per-holding % change over a range (registered before "/:id" so the static
  // path is not captured as an id). asOf scopes it to the historical view.
  router.get('/changes', (req, res) => {
    const range = String(req.query.range ?? 'ALL').toUpperCase();
    if (!isHistoryRange(range)) {
      throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    }
    res.json(holdingChanges(ctx, k, req.user!.id, range, asOfParam(req)));
  });

  router.post('/', async (req, res) => {
    const input = parseBody(schemas.create, req.body) as Record<string, unknown> & {
      valuationMode?: string; marketSymbol?: string; quantity?: number; valueMinor?: number;
      presentValueMinor?: number; interestRatePct?: number; asOf?: string; name?: string;
    };
    if (input.valuationMode === 'market') {
      if (!input.marketSymbol || !input.quantity) {
        throw badRequest('marketSymbol and quantity are required for market-valued entries');
      }
    } else if (input.valueMinor === undefined && !(input.asOf && input.presentValueMinor !== undefined)) {
      // A backdated entry may supply only a present-day value (the historic
      // value is then optional — used by vehicle depreciation, which anchors on
      // the present-day figure).
      throw badRequest('valueMinor is required for manually valued entries');
    }
    const dto = await createHolding(ctx, k, req.user!.id, input as never);
    audit(ctx.db, {
      userId: req.user!.id, action: `${k.kind}.create`, entityType: k.kind, entityId: dto.id, ip: req.ip,
    });
    // A liability with an interest rate gets a yearly percent schedule that
    // grows its balance. First accrual is one year after the entry's start.
    if (k.kind === 'liability' && typeof input.interestRatePct === 'number') {
      const start = input.asOf ?? todayISO(ctx.now);
      const rec = createRecurring(ctx, req.user!.id, {
        name: `${dto.name} interest`,
        targetType: 'liability',
        targetId: dto.id,
        percent: input.interestRatePct,
        cadence: 'yearly',
        nextRunOn: advanceCadence(start, 'yearly'),
      });
      audit(ctx.db, {
        userId: req.user!.id, action: 'recurring.create', entityType: 'recurring', entityId: rec.id, ip: req.ip,
      });
    }
    res.status(201).json(dto);
  });

  router.get('/:id', (req, res) => {
    res.json(getHolding(ctx, k, req.user!.id, idParam(req)));
  });

  router.patch('/:id', async (req, res) => {
    const patch = parseBody(schemas.update, req.body);
    const dto = await updateHolding(ctx, k, req.user!.id, idParam(req), patch as never);
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

  // ---- per-holding charts (detail popup): value-over-time line + pie ----

  // Daily value series for one holding, shaped like the dashboard history so
  // the detail line graph reuses the same chart and range presets.
  router.get('/:id/history', (req, res) => {
    const range = String(req.query.range ?? '1Y').toUpperCase();
    if (!isHistoryRange(range)) throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    let trendWindow = TREND_WINDOW_DEFAULT_DAYS;
    if (req.query.trendWindow !== undefined) {
      trendWindow = Number(req.query.trendWindow);
      if (!Number.isInteger(trendWindow)
        || trendWindow < TREND_WINDOW_MIN_DAYS || trendWindow > TREND_WINDOW_MAX_DAYS) {
        throw badRequest(
          `Invalid trendWindow; expected an integer between ${TREND_WINDOW_MIN_DAYS} and ${TREND_WINDOW_MAX_DAYS}`,
        );
      }
    }
    res.json(holdingHistory(ctx, k, req.user!.id, idParam(req), range, trendWindow));
  });

  // On-the-fly projection of one holding into the future (mirrors the dashboard
  // prediction graph). ALL is unbounded and rejected, as on the dashboard.
  router.get('/:id/prediction', async (req, res) => {
    const id = idParam(req);
    assertHoldingOwned(ctx, k, req.user!.id, id);
    const range = String(req.query.range ?? '1Y').toUpperCase();
    if (!isHistoryRange(range)) throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    if (range === 'ALL') throw badRequest('Prediction is not available for the ALL range');
    const today = todayISO(ctx.now);
    await primeUserMarketPrices(ctx, req.user!.id, addDays(today, -PREDICTION_LOOKBACK_DAYS), today);
    res.json(buildHoldingPrediction(ctx, req.user!.id, k, id, range));
  });

  // The holding's share of net worth for the pie: its value plus the totals of
  // every other asset/liability — current, as-of (view-as) or projected.
  router.get('/:id/composition', async (req, res) => {
    const id = idParam(req);
    assertHoldingOwned(ctx, k, req.user!.id, id);
    const range = req.query.range !== undefined ? String(req.query.range).toUpperCase() : undefined;
    res.json(
      await holdingComposition(ctx, k, req.user!.id, id, {
        asOf: asOfParam(req),
        predict: req.query.predict === '1',
        range,
      }),
    );
  });

  return router;
}
