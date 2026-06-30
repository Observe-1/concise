import type { AppContext } from '../../context.js';
import type { CompareDto, CompareHoldingDto, CompareTotalsDto } from '../../types/api.js';
import { ASSET_KIND, LIABILITY_KIND, type HoldingKind } from '../holdings/kind.js';
import { listHoldings } from '../holdings/service.js';
import { totalsAsOf } from '../snapshots/service.js';

function deltaPct(fromMinor: number, toMinor: number): number | null {
  if (fromMinor <= 0) return null;
  return Math.round(((toMinor - fromMinor) / fromMinor) * 100 * 100) / 100;
}

function totals(fromMinor: number, toMinor: number): CompareTotalsDto {
  return { fromMinor, toMinor, deltaMinor: toMinor - fromMinor, deltaPct: deltaPct(fromMinor, toMinor) };
}

function compareKind(ctx: AppContext, k: HoldingKind, userId: number, fromISO: string, toISO: string): CompareHoldingDto[] {
  const fromRows = new Map(listHoldings(ctx, k, userId, fromISO).map((h) => [h.id, h]));
  const toRows = new Map(listHoldings(ctx, k, userId, toISO).map((h) => [h.id, h]));
  const ids = new Set([...fromRows.keys(), ...toRows.keys()]);
  return [...ids].map((id) => {
    const from = fromRows.get(id);
    const to = toRows.get(id);
    const fromMinor = from?.currentValueMinor ?? 0;
    const toMinor = to?.currentValueMinor ?? 0;
    const ref = to ?? from!;
    return {
      id,
      kind: k.kind,
      category: ref.category,
      name: ref.name,
      fromMinor,
      toMinor,
      deltaMinor: toMinor - fromMinor,
      deltaPct: deltaPct(fromMinor, toMinor),
    };
  });
}

/**
 * Per-holding and totals delta between two dates. Inherits the app-wide
 * behaviour that a deleted holding silently drops out of historical reads
 * (listHoldings/totalsAsOf both query the live assets/liabilities tables) —
 * consistent with every other as-of view, not a new limitation.
 */
export function buildComparison(
  ctx: AppContext, userId: number, fromISO: string, toISO: string, currency: string,
): CompareDto {
  const holdings = [
    ...compareKind(ctx, ASSET_KIND, userId, fromISO, toISO),
    ...compareKind(ctx, LIABILITY_KIND, userId, fromISO, toISO),
  ].sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor));

  const from = totalsAsOf(ctx.db, userId, fromISO);
  const to = totalsAsOf(ctx.db, userId, toISO);

  return {
    from: fromISO,
    to: toISO,
    currency,
    holdings,
    netWorth: totals(from.assetsMinor - from.liabilitiesMinor, to.assetsMinor - to.liabilitiesMinor),
    assets: totals(from.assetsMinor, to.assetsMinor),
    liabilities: totals(from.liabilitiesMinor, to.liabilitiesMinor),
  };
}
