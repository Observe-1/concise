import type { AppContext } from '../../context.js';
import type { Cadence, RecurringDto } from '../../types/api.js';
import { withTransaction } from '../../db/connection.js';
import { advanceCadence, todayISO } from '../../lib/dates.js';
import { convertMinor } from '../../lib/fx.js';
import { badRequest, notFound } from '../../lib/http.js';
import { userCurrency } from '../holdings/service.js';
import { holdingValueMinor } from '../market/provider.js';
import { recomputeSnapshotRange } from '../snapshots/service.js';

interface RecurringRow {
  id: number;
  user_id: number;
  name: string;
  asset_id: number | null;
  liability_id: number | null;
  amount_type: 'fixed' | 'percent';
  amount_minor: number | null;
  percent: number | null;
  cadence: Cadence;
  next_run_on: string;
  last_run_on: string | null;
  end_date: string | null;
  active: number;
  target_name: string | null;
}

const SELECT = `
  SELECT r.*, COALESCE(a.name, l.name) AS target_name
  FROM recurring_transactions r
  LEFT JOIN assets a ON a.id = r.asset_id
  LEFT JOIN liabilities l ON l.id = r.liability_id`;

function toDto(row: RecurringRow): RecurringDto {
  return {
    id: row.id,
    name: row.name,
    targetType: row.asset_id !== null ? 'asset' : 'liability',
    targetId: (row.asset_id ?? row.liability_id)!,
    targetName: row.target_name ?? '(deleted)',
    amountType: row.amount_type,
    amountMinor: row.amount_minor,
    percent: row.percent,
    cadence: row.cadence,
    nextRunOn: row.next_run_on,
    lastRunOn: row.last_run_on,
    endDate: row.end_date,
    active: row.active === 1,
  };
}

export function listRecurring(ctx: AppContext, userId: number): RecurringDto[] {
  const rows = ctx.db
    .prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.created_at, r.id`)
    .all(userId) as unknown as RecurringRow[];
  return rows.map(toDto);
}

export interface CreateRecurringInput {
  name: string;
  targetType: 'asset' | 'liability';
  targetId: number;
  /** Exactly one of amountMinor (fixed) / percent must be provided. */
  amountMinor?: number;
  percent?: number;
  cadence: Cadence;
  nextRunOn: string;
  endDate?: string | null;
}

function assertTargetOwned(ctx: AppContext, userId: number, type: 'asset' | 'liability', id: number): void {
  const table = type === 'asset' ? 'assets' : 'liabilities';
  const row = ctx.db.prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) throw badRequest(`Target ${type} not found`);
}

export function createRecurring(ctx: AppContext, userId: number, input: CreateRecurringInput): RecurringDto {
  assertTargetOwned(ctx, userId, input.targetType, input.targetId);
  const isPercent = input.percent !== undefined;
  const id = ctx.db
    .prepare(
      `INSERT INTO recurring_transactions
         (user_id, name, asset_id, liability_id, amount_type, amount_minor, percent, cadence, next_run_on, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId, input.name,
      input.targetType === 'asset' ? input.targetId : null,
      input.targetType === 'liability' ? input.targetId : null,
      isPercent ? 'percent' : 'fixed',
      isPercent ? null : input.amountMinor!,
      isPercent ? input.percent! : null,
      input.cadence, input.nextRunOn, input.endDate ?? null,
    ).lastInsertRowid as number;
  return getRecurring(ctx, userId, id);
}

export function getRecurring(ctx: AppContext, userId: number, id: number): RecurringDto {
  const row = ctx.db
    .prepare(`${SELECT} WHERE r.user_id = ? AND r.id = ?`)
    .get(userId, id) as unknown as RecurringRow | undefined;
  if (!row) throw notFound('Recurring transaction not found');
  return toDto(row);
}

export interface UpdateRecurringInput {
  name?: string;
  amountMinor?: number;
  percent?: number;
  cadence?: Cadence;
  nextRunOn?: string;
  endDate?: string | null;
  active?: boolean;
}

export function updateRecurring(
  ctx: AppContext,
  userId: number,
  id: number,
  patch: UpdateRecurringInput,
): RecurringDto {
  const existing = getRecurring(ctx, userId, id);
  // Supplying percent switches the schedule to percent mode and vice versa;
  // otherwise the existing amount settings stand.
  let amountType = existing.amountType;
  let amountMinor = existing.amountMinor;
  let percent = existing.percent;
  if (patch.percent !== undefined) {
    amountType = 'percent';
    percent = patch.percent;
    amountMinor = null;
  } else if (patch.amountMinor !== undefined) {
    amountType = 'fixed';
    amountMinor = patch.amountMinor;
    percent = null;
  }
  const nextRunOn = patch.nextRunOn ?? existing.nextRunOn;
  const endDate = patch.endDate !== undefined ? patch.endDate : existing.endDate;
  if (endDate && endDate < nextRunOn) {
    throw badRequest('End date cannot be before the next run date');
  }
  ctx.db
    .prepare(
      `UPDATE recurring_transactions
       SET name = ?, amount_type = ?, amount_minor = ?, percent = ?, cadence = ?, next_run_on = ?, end_date = ?, active = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      amountType,
      amountMinor,
      percent,
      patch.cadence ?? existing.cadence,
      nextRunOn,
      endDate,
      (patch.active ?? existing.active) ? 1 : 0,
      id,
    );
  return getRecurring(ctx, userId, id);
}

export function deleteRecurring(ctx: AppContext, userId: number, id: number): void {
  getRecurring(ctx, userId, id); // 404 if not owned
  ctx.db.prepare('DELETE FROM recurring_transactions WHERE id = ?').run(id);
}

interface AssetMarketInfo {
  valuation_mode: string;
  market_symbol: string | null;
  quantity: number | null;
}

/**
 * The recurring engine. Processes every active schedule whose cursor is due
 * (next_run_on <= today), appending a 'recurring' valuation per occurrence:
 *   fixed:   new value = latest value + amount          (floored at 0)
 *   percent: new value = latest value × (1 + pct/100)   (floored at 0)
 * Market-priced (stock) assets are different: a fixed amount buys/sells that
 * much of the holding at the occurrence's own price, and a percent grows or
 * shrinks the share count directly — see the per-row branch below for why
 * that's mathematically exact regardless of price. Needs the price provider,
 * which is async, so prices for every due market target are primed once
 * up front (the "prime-then-read" pattern used elsewhere for the same
 * node:sqlite-transactions-must-be-synchronous reason) before the sync
 * transaction below reads them.
 *
 * The cursor advances per cadence until it points past today, so missed runs
 * catch up after downtime — each missed occurrence prices at its own date,
 * not one blended price. Affected users get their snapshots recomputed from
 * the earliest applied date. Idempotent: a processed occurrence moves the
 * cursor forward inside the same transaction.
 *
 * Paid off: when an occurrence drives a liability's balance to zero or below,
 * the balance is set to 0 and every recurring schedule against that liability
 * is suspended (active = 0) — no further payments or interest are applied
 * until the user reactivates it. (Non-market assets just floor at 0; they
 * keep running.) A market asset sold down to zero shares can't stay
 * market-mode (the DB requires quantity > 0 while it is) — it drops back to
 * a plain manual $0 asset, and just that one schedule deactivates, since
 * there's nothing left for it to sell. A market asset with no price for a
 * due date defers that occurrence instead (cursor doesn't advance) rather
 * than guessing or erroring.
 *
 * Returns the number of occurrences applied.
 */
export async function runDueRecurring(ctx: AppContext, userId?: number): Promise<number> {
  const today = todayISO(ctx.now);
  let applied = 0;
  const dueRows = ctx.db
    .prepare(
      `SELECT * FROM recurring_transactions
       WHERE active = 1 AND next_run_on <= ?${userId ? ' AND user_id = ?' : ''}`,
    )
    .all(...(userId ? [today, userId] : [today])) as unknown as RecurringRow[];

  // Market-mode info for every due asset target, fetched once up front so the
  // sync transaction below never has to query it mid-loop.
  const assetIds = [...new Set(dueRows.filter((r) => r.asset_id !== null).map((r) => r.asset_id!))];
  const assetInfo = new Map<number, AssetMarketInfo>();
  if (assetIds.length > 0) {
    const rows = ctx.db
      .prepare(`SELECT id, valuation_mode, market_symbol, quantity FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`)
      .all(...assetIds) as unknown as (AssetMarketInfo & { id: number })[];
    for (const r of rows) assetInfo.set(r.id, r);
  }
  const marketRows = dueRows.filter((r) => {
    const info = r.asset_id !== null ? assetInfo.get(r.asset_id) : undefined;
    return info?.valuation_mode === 'market' && info.market_symbol;
  });
  if (marketRows.length > 0) {
    const symbols = [...new Set(marketRows.map((r) => assetInfo.get(r.asset_id!)!.market_symbol!))];
    const earliestNextRunOn = marketRows.reduce((min, r) => (r.next_run_on < min ? r.next_run_on : min), today);
    await ctx.prices.prime(symbols, earliestNextRunOn, today);
    const instrumentCurrencies = symbols.map((s) => ctx.prices.instrumentCurrency(s));
    const userCurrencies = [...new Set(marketRows.map((r) => userCurrency(ctx, r.user_id)))];
    await ctx.prices.primeFxRates([...instrumentCurrencies, ...userCurrencies]);
  }

  // earliest applied date per user, for snapshot recompute
  const earliestByUser = new Map<number, string>();
  // liabilities paid off during this run — their other schedules are suspended
  const paidOffLiabilities = new Set<number>();
  const suspendForLiability = ctx.db.prepare(
    'UPDATE recurring_transactions SET active = 0 WHERE liability_id = ?',
  );

  withTransaction(ctx.db, () => {
    for (const row of dueRows) {
      const isAsset = row.asset_id !== null;
      const targetId = (row.asset_id ?? row.liability_id)!;
      // A payoff earlier in this run already suspended this liability's
      // schedules — don't apply any more occurrences against it.
      if (!isAsset && paidOffLiabilities.has(targetId)) continue;

      const market = isAsset ? assetInfo.get(targetId) : undefined;
      const isMarket = market?.valuation_mode === 'market' && !!market.market_symbol;

      let cursor = row.next_run_on;
      let lastRun = row.last_run_on;
      let paidOff = false;
      let expired = false;

      if (isMarket) {
        // Buys/sells shares at each occurrence's own price, rather than
        // overriding the value directly — see the function doc for why a
        // percent schedule scales the share count without needing a price.
        const symbol = market.market_symbol!;
        const instrumentCcy = ctx.prices.instrumentCurrency(symbol);
        const userCcy = userCurrency(ctx, row.user_id);
        const latestStmt = ctx.db.prepare(
          `SELECT value_minor, recorded_at FROM asset_valuations WHERE asset_id = ?
           ORDER BY recorded_at DESC, id DESC LIMIT 1`,
        );
        const insertStmt = ctx.db.prepare(
          `INSERT INTO asset_valuations (asset_id, value_minor, source, recorded_at)
           VALUES (?, ?, 'recurring', ?)`,
        );
        let quantity = market.quantity ?? 0;
        let soldOut = false;
        while (cursor <= today) {
          if (row.end_date && cursor > row.end_date) {
            expired = true;
            break;
          }
          const priceMinor = ctx.prices.getPriceMinor(symbol, cursor);
          const priceUserCcy = priceMinor === null
            ? null
            : convertMinor(priceMinor, instrumentCcy, userCcy, (c) => ctx.prices.fxRateLive(c));
          if (priceUserCcy === null || priceUserCcy <= 0) break; // no price yet — defer, retry next tick
          const sharesDelta = row.amount_type === 'percent'
            ? quantity * (row.percent! / 100)
            : row.amount_minor! / priceUserCcy;
          const rawQuantity = quantity + sharesDelta;
          // A sell that empties the holding can't be stored as a market-mode
          // quantity of 0 (the DB requires quantity > 0 while market-mode) —
          // closing the position out to a plain $0 manual asset is the
          // correct representation anyway: there's nothing left to hold.
          soldOut = rawQuantity <= 0;
          quantity = Math.max(0, rawQuantity);
          const newValue = soldOut ? 0 : holdingValueMinor(priceUserCcy, quantity);
          const latest = latestStmt.get(targetId) as
            | { value_minor: number; recorded_at: string }
            | undefined;
          let recordedAt = `${cursor}T00:00:00.000Z`;
          if (latest && latest.recorded_at >= recordedAt) {
            recordedAt = new Date(Date.parse(latest.recorded_at) + 1).toISOString();
          }
          insertStmt.run(targetId, newValue, recordedAt);
          applied++;
          const prevEarliest = earliestByUser.get(row.user_id);
          if (!prevEarliest || cursor < prevEarliest) earliestByUser.set(row.user_id, cursor);
          lastRun = cursor;
          cursor = advanceCadence(cursor, row.cadence);
          if (soldOut) break;
        }
        if (soldOut) {
          // Sold out for good: drop back to a manual $0 asset, and this
          // schedule (alone — siblings aren't touched, unlike a liability
          // payoff) stops, since there's nothing left for it to sell.
          ctx.db
            .prepare("UPDATE assets SET valuation_mode = 'manual', market_symbol = NULL, quantity = NULL WHERE id = ?")
            .run(targetId);
          expired = true;
        } else {
          ctx.db.prepare('UPDATE assets SET quantity = ? WHERE id = ?').run(quantity, targetId);
        }
      } else {
        const valuationTable = isAsset ? 'asset_valuations' : 'liability_valuations';
        const fk = isAsset ? 'asset_id' : 'liability_id';

        const latestStmt = ctx.db.prepare(
          `SELECT value_minor, recorded_at FROM ${valuationTable} WHERE ${fk} = ?
           ORDER BY recorded_at DESC, id DESC LIMIT 1`,
        );
        const insertStmt = ctx.db.prepare(
          `INSERT INTO ${valuationTable} (${fk}, value_minor, source, recorded_at)
           VALUES (?, ?, 'recurring', ?)`,
        );

        while (cursor <= today) {
          // Past its end date: stop here (inclusive — an occurrence landing
          // exactly on the end date still fires) and deactivate just this row.
          if (row.end_date && cursor > row.end_date) {
            expired = true;
            break;
          }
          const latest = latestStmt.get(targetId) as
            | { value_minor: number; recorded_at: string }
            | undefined;
          const current = latest?.value_minor ?? 0;
          const rawValue = row.amount_type === 'percent'
            ? Math.round(current * (1 + row.percent! / 100))
            : current + row.amount_minor!;
          const newValue = Math.max(0, rawValue);
          // Record on the scheduled day, but never before the latest existing
          // valuation — the occurrence supersedes it as the current value.
          let recordedAt = `${cursor}T00:00:00.000Z`;
          if (latest && latest.recorded_at >= recordedAt) {
            recordedAt = new Date(Date.parse(latest.recorded_at) + 1).toISOString();
          }
          insertStmt.run(targetId, newValue, recordedAt);
          applied++;
          const prevEarliest = earliestByUser.get(row.user_id);
          if (!prevEarliest || cursor < prevEarliest) earliestByUser.set(row.user_id, cursor);
          lastRun = cursor;
          cursor = advanceCadence(cursor, row.cadence);
          // A liability hitting zero is paid off: stop here and suspend it.
          if (!isAsset && rawValue <= 0) {
            paidOff = true;
            paidOffLiabilities.add(targetId);
            break;
          }
        }
      }
      ctx.db
        .prepare('UPDATE recurring_transactions SET next_run_on = ?, last_run_on = ?, active = ? WHERE id = ?')
        .run(cursor, lastRun, expired ? 0 : 1, row.id);
      // Paid off: suspend every schedule against the liability (this row and
      // any siblings). Done after the cursor update so this row's cursor still
      // reflects the work applied.
      if (paidOff) suspendForLiability.run(targetId);
    }
    for (const [uid, from] of earliestByUser) {
      recomputeSnapshotRange(ctx.db, uid, from, today);
    }
  });
  return applied;
}
