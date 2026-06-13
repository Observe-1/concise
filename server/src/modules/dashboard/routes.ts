import { Router } from 'express';
import type { AppContext } from '../../context.js';
import type {
  CategoryTotalDto, DashboardChangesDto, DashboardSummaryDto, HistoryDto, HistoryPointDto,
  HistoryRange, HoldingDto,
} from '../../types/api.js';
import { HISTORY_RANGES, isHistoryRange, rangeStart, todayISO } from '../../lib/dates.js';
import { asOfParam, badRequest } from '../../lib/http.js';
import { ASSET_KIND, LIABILITY_KIND } from '../holdings/kind.js';
import { listHoldings } from '../holdings/service.js';
import { buildPrediction } from './prediction.js';

const MAX_GRAPH_POINTS = 400;

// Trend smoothing window in days. The client may override per request via
// ?trendWindow= within these bounds; whatever the window, it is applied to
// the FULL history so a date's trend value is identical whatever range the
// client requests — the trend must never re-fit to the visible window.
export const TREND_WINDOW_DEFAULT_DAYS = 91;
export const TREND_WINDOW_MIN_DAYS = 7;
export const TREND_WINDOW_MAX_DAYS = 365;

/**
 * Centred moving average over the full daily series. Returns one trend value
 * per input row (edges use the partial window). O(n) via prefix sums.
 */
export function computeTrend(values: number[], windowDays = TREND_WINDOW_DEFAULT_DAYS): number[] {
  const half = Math.floor(windowDays / 2);
  const prefix = new Array<number>(values.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    return Math.round((prefix[hi + 1]! - prefix[lo]!) / (hi - lo + 1));
  });
}

function byCategory(holdings: HoldingDto[]): CategoryTotalDto[] {
  const map = new Map<string, CategoryTotalDto>();
  for (const h of holdings) {
    const entry = map.get(h.category) ?? { category: h.category, totalMinor: 0, count: 0 };
    entry.totalMinor += h.currentValueMinor;
    entry.count += 1;
    map.set(h.category, entry);
  }
  return [...map.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}

/** Thin the series to at most `max` points, always keeping both endpoints
 *  (isolated early points, e.g. legacy wealth, must survive). */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = points.length - 1; i >= 0; i -= stride) out.push(points[i]!);
  out.reverse();
  if (out[0] !== points[0]) {
    out.unshift(points[0]!);
    if (out.length > max) out.splice(1, 1);
  }
  return out;
}

export function dashboardRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/summary', (req, res) => {
    const userId = req.user!.id;
    // Historical view: totals and breakdowns as the portfolio stood on asOf.
    const asOf = asOfParam(req);
    const assets = listHoldings(ctx, ASSET_KIND, userId, asOf);
    const liabilities = listHoldings(ctx, LIABILITY_KIND, userId, asOf);
    const assetsMinor = assets.reduce((sum, a) => sum + a.currentValueMinor, 0);
    const liabilitiesMinor = liabilities.reduce((sum, l) => sum + l.currentValueMinor, 0);
    const summary: DashboardSummaryDto = {
      assetsMinor,
      liabilitiesMinor,
      netWorthMinor: assetsMinor - liabilitiesMinor,
      currency: req.user!.currency,
      assetsByCategory: byCategory(assets),
      liabilitiesByCategory: byCategory(liabilities),
    };
    res.json(summary);
  });

  // Percent change of the portfolio totals over a range, from the snapshot
  // series (so it matches the graph). Mirrors the holdings /changes endpoint.
  router.get('/changes', (req, res) => {
    const range = String(req.query.range ?? 'ALL').toUpperCase();
    if (!isHistoryRange(range)) {
      throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    }
    const ref = asOfParam(req) ?? todayISO(ctx.now);
    const start = rangeStart(range, ref);
    const snapAt = (cutoff: string) =>
      ctx.db
        .prepare(
          `SELECT assets_minor, liabilities_minor, net_worth_minor FROM snapshots
           WHERE user_id = ? AND snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`,
        )
        .get(req.user!.id, cutoff) as
        | { assets_minor: number; liabilities_minor: number; net_worth_minor: number }
        | undefined;
    const end = snapAt(ref);
    const base = start
      ? snapAt(start)
      : (ctx.db
          .prepare(
            `SELECT assets_minor, liabilities_minor, net_worth_minor FROM snapshots
             WHERE user_id = ? ORDER BY snapshot_date LIMIT 1`,
          )
          .get(req.user!.id) as
          | { assets_minor: number; liabilities_minor: number; net_worth_minor: number }
          | undefined);
    // Percent change, null unless the base is strictly positive (handles a
    // missing base and a non-positive net worth uniformly).
    const pct = (e: number, b: number): number | null =>
      b > 0 ? Math.round(((e - b) / b) * 100 * 100) / 100 : null;
    const dto: DashboardChangesDto = {
      range: range as HistoryRange,
      assetsChangePct: end && base ? pct(end.assets_minor, base.assets_minor) : null,
      liabilitiesChangePct: end && base ? pct(end.liabilities_minor, base.liabilities_minor) : null,
      netWorthChangePct: end && base ? pct(end.net_worth_minor, base.net_worth_minor) : null,
    };
    res.json(dto);
  });

  // Prediction mode: a small slice of history plus on-the-fly projected
  // future values. ALL is unbounded and not offered (the UI hides it).
  router.get('/prediction', (req, res) => {
    const range = String(req.query.range ?? '1Y').toUpperCase();
    if (!isHistoryRange(range)) {
      throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    }
    if (range === 'ALL') throw badRequest('Prediction is not available for the ALL range');
    res.json(buildPrediction(ctx, req.user!.id, range as HistoryRange));
  });

  router.get('/history', (req, res) => {
    const range = String(req.query.range ?? 'ALL').toUpperCase();
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
    const start = rangeStart(range as HistoryRange, todayISO(ctx.now));

    // Always load the FULL history: the trend is derived from the whole
    // dataset, then the requested window is sliced out of it.
    const rows = ctx.db
      .prepare(
        `SELECT snapshot_date AS date, assets_minor, liabilities_minor, net_worth_minor
         FROM snapshots
         WHERE user_id = ?
         ORDER BY snapshot_date`,
      )
      .all(req.user!.id) as unknown as {
        date: string; assets_minor: number; liabilities_minor: number; net_worth_minor: number;
      }[];
    const trend = computeTrend(rows.map((r) => r.net_worth_minor), trendWindow);

    const points: HistoryPointDto[] = [];
    rows.forEach((r, i) => {
      if (start && r.date < start) return;
      points.push({
        date: r.date,
        assetsMinor: r.assets_minor,
        liabilitiesMinor: r.liabilities_minor,
        netWorthMinor: r.net_worth_minor,
        trendMinor: trend[i]!,
      });
    });
    const dto: HistoryDto = {
      range: range as HistoryRange,
      trendWindow,
      points: downsample(points, MAX_GRAPH_POINTS),
    };
    res.json(dto);
  });

  return router;
}
