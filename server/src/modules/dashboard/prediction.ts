import type { AppContext } from '../../context.js';
import type { Cadence, HistoryPointDto, HistoryRange, PredictionDto } from '../../types/api.js';
import { addDays, advanceCadence, daysBetween, rangeForwardEnd, todayISO } from '../../lib/dates.js';
import { PROPERTY_COUNTRIES, propertyValueMinor, vehicleValueMinor } from '../market/models.js';
import { downsample } from './routes.js';

const MAX_GRAPH_POINTS = 400;
// The simulated provider's data begins here; clamp the return lookback to it.
const PRICE_ORIGIN = '2020-01-01';
// Guard rails on the annualised stock return so a noisy estimate can't make
// the projection explode or collapse.
const RETURN_FLOOR = -0.4;
const RETURN_CAP = 0.4;

interface AssetRow {
  id: number;
  valuation_mode: string;
  market_symbol: string | null;
  quantity: number | null;
  country: string | null;
  manufacture_date: string | null;
}

interface ScheduleRow {
  asset_id: number | null;
  liability_id: number | null;
  amount_type: 'fixed' | 'percent';
  amount_minor: number | null;
  percent: number | null;
  cadence: Cadence;
  next_run_on: string;
}

/**
 * Average annualised return for a symbol over the last ~10 years (or the
 * maximum the provider can supply), clamped to a sane band. Used to project a
 * market holding's value forward.
 */
function annualReturn(ctx: AppContext, symbol: string, today: string): number {
  const pNow = ctx.prices.getPriceMinor(symbol, today);
  if (!pNow) return 0;
  let thenISO = addDays(today, -3653); // ~10 years
  if (thenISO < PRICE_ORIGIN) thenISO = PRICE_ORIGIN;
  let pThen = ctx.prices.getPriceMinor(symbol, thenISO);
  for (let i = 0; i < 60 && pThen === null; i++) {
    thenISO = addDays(thenISO, 1);
    pThen = ctx.prices.getPriceMinor(symbol, thenISO);
  }
  const years = daysBetween(thenISO, today) / 365.25;
  if (!pThen || pThen <= 0 || years <= 0) return 0;
  const r = Math.pow(pNow / pThen, 1 / years) - 1;
  return Math.max(RETURN_FLOOR, Math.min(RETURN_CAP, r));
}

/** A manual holding's future values: start at `current`, apply each future
 *  recurring occurrence (fixed adds, percent compounds, floored at 0). A
 *  liability driven to zero is paid off — its schedules stop (matches the
 *  recurring engine). */
function projectManual(
  current: number,
  isLiability: boolean,
  schedules: ScheduleRow[],
  dates: string[],
  today: string,
): number[] {
  const last = dates[dates.length - 1]!;
  const occ: { date: string; type: 'fixed' | 'percent'; amount: number | null; percent: number | null }[] = [];
  for (const s of schedules) {
    let c = s.next_run_on;
    while (c <= today) c = advanceCadence(c, s.cadence); // skip overdue (the live engine applies those)
    while (c <= last) {
      occ.push({ date: c, type: s.amount_type, amount: s.amount_minor, percent: s.percent });
      c = advanceCadence(c, s.cadence);
    }
  }
  occ.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = current;
  let oi = 0;
  let suspended = false;
  return dates.map((d) => {
    while (!suspended && oi < occ.length && occ[oi]!.date <= d) {
      const o = occ[oi++]!;
      const raw = o.type === 'percent'
        ? Math.round(running * (1 + o.percent! / 100))
        : running + o.amount!;
      running = Math.max(0, raw);
      if (isLiability && raw <= 0) {
        running = 0;
        suspended = true;
      }
    }
    return running;
  });
}

/**
 * Build the prediction series for a range: a small slice of real history
 * (≈ range/10) followed by projected future values to the forward horizon.
 * Projections are computed on the fly — market holdings grow by their average
 * return, model holdings continue their formula, and manual holdings follow
 * their recurring schedules. Nothing is persisted.
 */
export function buildPrediction(ctx: AppContext, userId: number, range: HistoryRange): PredictionDto {
  const today = todayISO(ctx.now);
  const futureEnd = rangeForwardEnd(range, today);
  if (!futureEnd) return { range, today, points: [] }; // ALL has no bounded future

  const futureDays = daysBetween(today, futureEnd);
  const historyStart = addDays(today, -Math.max(1, Math.round(futureDays / 10)));
  const cutoff = `${today}T23:59:59.999Z`;

  // --- history slice (real snapshots up to and including today) ---
  const points: HistoryPointDto[] = (ctx.db
    .prepare(
      `SELECT snapshot_date AS date, assets_minor, liabilities_minor, net_worth_minor
       FROM snapshots WHERE user_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
       ORDER BY snapshot_date`,
    )
    .all(userId, historyStart, today) as unknown as {
      date: string; assets_minor: number; liabilities_minor: number; net_worth_minor: number;
    }[]).map((r) => ({
      date: r.date,
      assetsMinor: r.assets_minor,
      liabilitiesMinor: r.liabilities_minor,
      netWorthMinor: r.net_worth_minor,
      trendMinor: r.net_worth_minor,
    }));

  // --- gather current state ---
  const valueAt = ctx.db.prepare(
    `SELECT value_minor FROM asset_valuations WHERE asset_id = ? AND recorded_at <= ?
     ORDER BY recorded_at DESC, id DESC LIMIT 1`,
  );
  const manualAnchor = ctx.db.prepare(
    `SELECT value_minor, recorded_at FROM asset_valuations
     WHERE asset_id = ? AND source = 'manual' AND recorded_at <= ?
     ORDER BY recorded_at DESC, id DESC LIMIT 1`,
  );
  const earliestAnchor = ctx.db.prepare(
    `SELECT value_minor, recorded_at FROM asset_valuations WHERE asset_id = ? AND recorded_at <= ?
     ORDER BY recorded_at, id LIMIT 1`,
  );
  const liabValueAt = ctx.db.prepare(
    `SELECT value_minor FROM liability_valuations WHERE liability_id = ? AND recorded_at <= ?
     ORDER BY recorded_at DESC, id DESC LIMIT 1`,
  );

  const assets = ctx.db
    .prepare(
      `SELECT id, valuation_mode, market_symbol, quantity, country, manufacture_date
       FROM assets WHERE user_id = ?`,
    )
    .all(userId) as unknown as AssetRow[];
  const liabilities = ctx.db
    .prepare('SELECT id FROM liabilities WHERE user_id = ?')
    .all(userId) as { id: number }[];

  const schedules = ctx.db
    .prepare(
      `SELECT asset_id, liability_id, amount_type, amount_minor, percent, cadence, next_run_on
       FROM recurring_transactions WHERE user_id = ? AND active = 1`,
    )
    .all(userId) as unknown as ScheduleRow[];
  const byAsset = new Map<number, ScheduleRow[]>();
  const byLiability = new Map<number, ScheduleRow[]>();
  for (const s of schedules) {
    if (s.asset_id !== null) byAsset.set(s.asset_id, [...(byAsset.get(s.asset_id) ?? []), s]);
    else if (s.liability_id !== null) byLiability.set(s.liability_id, [...(byLiability.get(s.liability_id) ?? []), s]);
  }

  // --- future dates (today+1 .. futureEnd) ---
  const dates: string[] = [];
  for (let d = addDays(today, 1); d <= futureEnd; d = addDays(d, 1)) dates.push(d);

  const returnCache = new Map<string, number>();
  const projectAsset = (a: AssetRow): number[] => {
    const current = (valueAt.get(a.id, cutoff) as { value_minor: number } | undefined)?.value_minor ?? 0;
    if (a.valuation_mode === 'market' && a.market_symbol && a.quantity) {
      const sym = a.market_symbol;
      if (!returnCache.has(sym)) returnCache.set(sym, annualReturn(ctx, sym, today));
      const r = returnCache.get(sym)!;
      return dates.map((d) => {
        const years = daysBetween(today, d) / 365.25;
        return Math.max(0, Math.round(current * Math.pow(1 + r, years)));
      });
    }
    if (a.valuation_mode === 'property_index' || a.valuation_mode === 'depreciation') {
      const anchor = (manualAnchor.get(a.id, cutoff) ?? earliestAnchor.get(a.id, cutoff)) as
        | { value_minor: number; recorded_at: string }
        | undefined;
      if (!anchor) return dates.map(() => current);
      const baseDate = anchor.recorded_at.slice(0, 10);
      if (a.valuation_mode === 'property_index') {
        const rate = PROPERTY_COUNTRIES[a.country ?? '']?.annualRatePct ?? 0;
        return dates.map((d) => Math.max(0, propertyValueMinor(anchor.value_minor, baseDate, d, rate)));
      }
      if (a.manufacture_date) {
        return dates.map((d) => Math.max(0, vehicleValueMinor(anchor.value_minor, baseDate, a.manufacture_date!, d)));
      }
      return dates.map(() => current);
    }
    // manual asset: follow its recurring schedules
    return projectManual(current, false, byAsset.get(a.id) ?? [], dates, today);
  };

  const assetSeries = assets.map(projectAsset);
  const liabilitySeries = liabilities.map((l) => {
    const current = (liabValueAt.get(l.id, cutoff) as { value_minor: number } | undefined)?.value_minor ?? 0;
    return projectManual(current, true, byLiability.get(l.id) ?? [], dates, today);
  });

  dates.forEach((date, i) => {
    let assetsMinor = 0;
    let liabilitiesMinor = 0;
    for (const s of assetSeries) assetsMinor += s[i]!;
    for (const s of liabilitySeries) liabilitiesMinor += s[i]!;
    const netWorthMinor = assetsMinor - liabilitiesMinor;
    points.push({ date, assetsMinor, liabilitiesMinor, netWorthMinor, trendMinor: netWorthMinor });
  });

  return { range, today, points: downsample(points, MAX_GRAPH_POINTS) };
}
