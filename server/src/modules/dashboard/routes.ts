import { Router } from 'express';
import type { AppContext } from '../../context.js';
import type {
  CategoryTotalDto, DashboardSummaryDto, HistoryDto, HistoryPointDto, HistoryRange, HoldingDto,
} from '../../types/api.js';
import { rangeStart, todayISO } from '../../lib/dates.js';
import { badRequest } from '../../lib/http.js';
import { ASSET_KIND, LIABILITY_KIND } from '../holdings/kind.js';
import { listHoldings } from '../holdings/service.js';

const MAX_GRAPH_POINTS = 400;
const RANGES: ReadonlySet<string> = new Set(['1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', '20Y', 'ALL']);

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
    const assets = listHoldings(ctx, ASSET_KIND, userId);
    const liabilities = listHoldings(ctx, LIABILITY_KIND, userId);
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

  router.get('/history', (req, res) => {
    const range = String(req.query.range ?? 'ALL').toUpperCase();
    if (!RANGES.has(range)) throw badRequest(`Invalid range; expected one of ${[...RANGES].join(', ')}`);
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
