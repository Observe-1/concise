import type { AppContext } from '../../context.js';
import { withTransaction } from '../../db/connection.js';
import { todayISO } from '../../lib/dates.js';
import { upsertSnapshot } from '../snapshots/service.js';
import { holdingValueMinor } from './provider.js';

interface MarketAssetRow {
  id: number;
  user_id: number;
  market_symbol: string;
  quantity: number;
}

/**
 * Re-price every market-valued asset (optionally for one user) using the
 * price provider. At most one market valuation is appended per asset per day.
 * Returns the number of assets re-priced.
 */
export function refreshMarketValuations(ctx: AppContext, userId?: number): number {
  const today = todayISO(ctx.now);
  const rows = ctx.db
    .prepare(
      `SELECT id, user_id, market_symbol, quantity FROM assets
       WHERE valuation_mode = 'market'${userId ? ' AND user_id = ?' : ''}`,
    )
    .all(...(userId ? [userId] : [])) as unknown as MarketAssetRow[];
  if (rows.length === 0) return 0;

  let updated = 0;
  const touchedUsers = new Set<number>();
  withTransaction(ctx.db, () => {
    const alreadyToday = ctx.db.prepare(
      `SELECT 1 FROM asset_valuations
       WHERE asset_id = ? AND source = 'market' AND recorded_at >= ? AND recorded_at <= ?
       LIMIT 1`,
    );
    const insert = ctx.db.prepare(
      `INSERT INTO asset_valuations (asset_id, value_minor, source, recorded_at)
       VALUES (?, ?, 'market', ?)`,
    );
    for (const row of rows) {
      if (alreadyToday.get(row.id, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`)) continue;
      const value = holdingValueMinor(ctx.prices.getPriceMinor(row.market_symbol, today), row.quantity);
      insert.run(row.id, value, ctx.now().toISOString());
      touchedUsers.add(row.user_id);
      updated++;
    }
    for (const uid of touchedUsers) upsertSnapshot(ctx.db, uid, today);
  });
  return updated;
}
