import { Router } from 'express';
import type { AppContext } from '../../context.js';
import type {
  CategoryTotalDto, DashboardChangesDto, DashboardSummaryDto, HistoryDto, HistoryPointDto,
  HistoryRange, HoldingDto,
} from '../../types/api.js';
import { addDays, HISTORY_RANGES, isHistoryRange, rangeStart, todayISO } from '../../lib/dates.js';
import { asOfParam, badRequest } from '../../lib/http.js';
import {
  computeTrend, downsample, MAX_GRAPH_POINTS,
  TREND_WINDOW_DEFAULT_DAYS, TREND_WINDOW_MAX_DAYS, TREND_WINDOW_MIN_DAYS,
} from '../../lib/series.js';
import { ASSET_KIND, LIABILITY_KIND } from '../holdings/kind.js';
import { listHoldings } from '../holdings/service.js';
import { primeUserMarketPrices } from '../market/service.js';
import { buildPrediction, predictionTarget, projectPortfolioAt } from './prediction.js';

// Re-exported so existing importers (and the unit tests) keep their paths.
export { computeTrend, downsample } from '../../lib/series.js';
export {
  TREND_WINDOW_DEFAULT_DAYS, TREND_WINDOW_MAX_DAYS, TREND_WINDOW_MIN_DAYS,
} from '../../lib/series.js';

// Projections estimate a market holding's growth from ~10 years of its own
// price history, so the price cache is warmed over this window before any
// projection runs (a no-op for the simulated provider).
const PREDICTION_LOOKBACK_DAYS = 3660;

function byCategory(items: { category: string; valueMinor: number }[]): CategoryTotalDto[] {
  const map = new Map<string, CategoryTotalDto>();
  for (const item of items) {
    const entry = map.get(item.category) ?? { category: item.category, totalMinor: 0, count: 0 };
    entry.totalMinor += item.valueMinor;
    entry.count += 1;
    map.set(item.category, entry);
  }
  return [...map.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}

const catItems = (holdings: HoldingDto[]) =>
  holdings.map((h) => ({ category: h.category, valueMinor: h.currentValueMinor }));

export function dashboardRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/summary', async (req, res) => {
    const userId = req.user!.id;
    const asOf = asOfParam(req);

    // Prediction mode: report the projected portfolio (totals + breakdowns) so
    // every summary card reflects the future, not today's live values. The
    // target is the view-as date if pinned, else the range's forward horizon.
    if (req.query.predict === '1') {
      const today = todayISO(ctx.now);
      const target = predictionTarget(String(req.query.range ?? '').toUpperCase(), asOf, today);
      if (target) {
        await primeUserMarketPrices(ctx, userId, addDays(today, -PREDICTION_LOOKBACK_DAYS), today);
        const { assets, liabilities } = projectPortfolioAt(ctx, userId, today, target);
        const assetsMinor = assets.reduce((sum, a) => sum + a.projectedMinor, 0);
        const liabilitiesMinor = liabilities.reduce((sum, l) => sum + l.projectedMinor, 0);
        const projected: DashboardSummaryDto = {
          assetsMinor,
          liabilitiesMinor,
          netWorthMinor: assetsMinor - liabilitiesMinor,
          currency: req.user!.currency,
          assetsByCategory: byCategory(assets.map((a) => ({ category: a.category, valueMinor: a.projectedMinor }))),
          liabilitiesByCategory: byCategory(liabilities.map((l) => ({ category: l.category, valueMinor: l.projectedMinor }))),
        };
        res.json(projected);
        return;
      }
    }

    // Historical view: totals and breakdowns as the portfolio stood on asOf.
    const assets = listHoldings(ctx, ASSET_KIND, userId, asOf);
    const liabilities = listHoldings(ctx, LIABILITY_KIND, userId, asOf);
    const assetsMinor = assets.reduce((sum, a) => sum + a.currentValueMinor, 0);
    const liabilitiesMinor = liabilities.reduce((sum, l) => sum + l.currentValueMinor, 0);
    const summary: DashboardSummaryDto = {
      assetsMinor,
      liabilitiesMinor,
      netWorthMinor: assetsMinor - liabilitiesMinor,
      currency: req.user!.currency,
      assetsByCategory: byCategory(catItems(assets)),
      liabilitiesByCategory: byCategory(catItems(liabilities)),
    };
    res.json(summary);
  });

  // Percent change of the portfolio totals over a range, from the snapshot
  // series (so it matches the graph). Mirrors the holdings /changes endpoint.
  router.get('/changes', async (req, res) => {
    const range = String(req.query.range ?? 'ALL').toUpperCase();
    if (!isHistoryRange(range)) {
      throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    }
    const asOf = asOfParam(req);
    // Percent change, null unless the base is strictly positive (handles a
    // missing base and a non-positive net worth uniformly).
    const pct = (e: number, b: number): number | null =>
      b > 0 ? Math.round(((e - b) / b) * 100 * 100) / 100 : null;

    // Prediction mode: percentages become projected growth from today's live
    // totals to the projected (horizon or view-as) date.
    if (req.query.predict === '1') {
      const today = todayISO(ctx.now);
      const target = predictionTarget(range, asOf, today);
      if (target) {
        await primeUserMarketPrices(ctx, req.user!.id, addDays(today, -PREDICTION_LOOKBACK_DAYS), today);
        const { assets, liabilities } = projectPortfolioAt(ctx, req.user!.id, today, target);
        const sum = (xs: { currentMinor: number; projectedMinor: number }[], k: 'currentMinor' | 'projectedMinor') =>
          xs.reduce((s, x) => s + x[k], 0);
        const baseA = sum(assets, 'currentMinor');
        const baseL = sum(liabilities, 'currentMinor');
        const endA = sum(assets, 'projectedMinor');
        const endL = sum(liabilities, 'projectedMinor');
        res.json({
          range: range as HistoryRange,
          assetsChangePct: pct(endA, baseA),
          liabilitiesChangePct: pct(endL, baseL),
          netWorthChangePct: pct(endA - endL, baseA - baseL),
        } satisfies DashboardChangesDto);
        return;
      }
    }

    const ref = asOf ?? todayISO(ctx.now);
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
  router.get('/prediction', async (req, res) => {
    const range = String(req.query.range ?? '1Y').toUpperCase();
    if (!isHistoryRange(range)) {
      throw badRequest(`Invalid range; expected one of ${HISTORY_RANGES.join(', ')}`);
    }
    if (range === 'ALL') throw badRequest('Prediction is not available for the ALL range');
    const today = todayISO(ctx.now);
    await primeUserMarketPrices(ctx, req.user!.id, addDays(today, -PREDICTION_LOOKBACK_DAYS), today);
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
