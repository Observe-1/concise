import type { AppContext } from '../../context.js';
import type { HoldingCompositionDto } from '../../types/api.js';
import { addDays, todayISO } from '../../lib/dates.js';
import type { HoldingKind } from '../holdings/kind.js';
import { primeUserMarketPrices } from '../market/service.js';
import { holdingDailySeries, totalsAsOf } from '../snapshots/service.js';
import { predictionTarget, projectHoldingAt, projectPortfolioAt } from './prediction.js';

// Market-return estimates look back ~10 years; warm that window before any
// projection runs (a no-op for the simulated provider).
const PREDICTION_LOOKBACK_DAYS = 3660;

/**
 * The selected holding's value as of the end of `refISO`, using the SAME
 * gap-interpolating daily series as the detail line graph (`holdingDailySeries`)
 * — not the raw latest valuation — so the pie's gold slice matches the value
 * the line graph shows at the scrubbed date (the feature's stated goal). The
 * series must run to `today`, not stop at `refISO`: a manual revaluation that
 * ends the gap can be recorded *after* the scrubbed date, and interpolation
 * needs that closing anchor loaded (a series cut off at `refISO` would only see
 * the opening anchor and return the step value). We take the first day (refISO).
 * The "other" totals stay step (via `totalsAsOf`, matching the dashboard as-of
 * summary); the small residual only ever shows strictly inside a manual gap.
 */
function holdingValueAsOf(ctx: AppContext, k: HoldingKind, id: number, refISO: string, today: string): number {
  return holdingDailySeries(ctx.db, k, id, refISO, today)[0] ?? 0;
}

function build(
  side: 'asset' | 'liability',
  selected: number,
  totalAssets: number,
  totalLiabilities: number,
): HoldingCompositionDto {
  return {
    side,
    selectedMinor: selected,
    // Exclude the selected holding from its own side's "other" total.
    otherAssetsMinor: Math.max(0, totalAssets - (side === 'asset' ? selected : 0)),
    otherLiabilitiesMinor: Math.max(0, totalLiabilities - (side === 'liability' ? selected : 0)),
  };
}

/**
 * The selected holding's place in the net-worth pie. Mirrors the dashboard
 * summary's modes so the detail pie agrees with the detail line graph:
 *  - prediction: totals + the holding projected to the target (view-as date if
 *    pinned in the future, else the range's forward horizon);
 *  - view-as / live: totals + the holding as of the pinned date (or today).
 * When prediction has no bounded future target it falls back to the live/view-as
 * path (exactly like the summary route).
 */
export async function holdingComposition(
  ctx: AppContext,
  k: HoldingKind,
  userId: number,
  id: number,
  opts: { asOf?: string; predict?: boolean; range?: string },
): Promise<HoldingCompositionDto> {
  const today = todayISO(ctx.now);
  const side = k.kind;

  if (opts.predict) {
    const target = predictionTarget(opts.range ?? '', opts.asOf, today);
    if (target) {
      await primeUserMarketPrices(ctx, userId, addDays(today, -PREDICTION_LOOKBACK_DAYS), today);
      const { assets, liabilities } = projectPortfolioAt(ctx, userId, today, target);
      const totalAssets = assets.reduce((s, a) => s + a.projectedMinor, 0);
      const totalLiabilities = liabilities.reduce((s, l) => s + l.projectedMinor, 0);
      const selected = projectHoldingAt(ctx, userId, k, id, today, target);
      return build(side, selected, totalAssets, totalLiabilities);
    }
  }

  const ref = opts.asOf ?? today;
  const { assetsMinor, liabilitiesMinor } = totalsAsOf(ctx.db, userId, ref);
  const selected = holdingValueAsOf(ctx, k, id, ref, today);
  return build(side, selected, assetsMinor, liabilitiesMinor);
}
