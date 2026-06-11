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
const RANGES: ReadonlySet<string> = new Set(['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'ALL']);

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

/** Thin the series to at most `max` points, always keeping the latest one. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = points.length - 1; i >= 0; i -= stride) out.push(points[i]!);
  return out.reverse();
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
    const start = rangeStart(range as HistoryRange, todayISO(ctx.now));
    const rows = ctx.db
      .prepare(
        `SELECT snapshot_date AS date, assets_minor, liabilities_minor, net_worth_minor
         FROM snapshots
         WHERE user_id = ? ${start ? 'AND snapshot_date >= ?' : ''}
         ORDER BY snapshot_date`,
      )
      .all(...(start ? [req.user!.id, start] : [req.user!.id])) as unknown as {
        date: string; assets_minor: number; liabilities_minor: number; net_worth_minor: number;
      }[];
    const points: HistoryPointDto[] = rows.map((r) => ({
      date: r.date,
      assetsMinor: r.assets_minor,
      liabilitiesMinor: r.liabilities_minor,
      netWorthMinor: r.net_worth_minor,
    }));
    const dto: HistoryDto = { range: range as HistoryRange, points: downsample(points, MAX_GRAPH_POINTS) };
    res.json(dto);
  });

  return router;
}
