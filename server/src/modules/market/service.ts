import type { AppContext } from '../../context.js';
import { withTransaction } from '../../db/connection.js';
import { todayISO } from '../../lib/dates.js';
import { upsertSnapshot } from '../snapshots/service.js';
import { PROPERTY_COUNTRIES, propertyValueMinor, vehicleValueMinor } from './models.js';
import { holdingValueMinor } from './provider.js';

interface AutoValuedRow {
  id: number;
  user_id: number;
  valuation_mode: 'market' | 'property_index' | 'depreciation';
  market_symbol: string | null;
  quantity: number | null;
  country: string | null;
  manufacture_date: string | null;
}

/**
 * Re-price every auto-valued asset (optionally for one user): market entries
 * from the price provider, model entries (property index) from their formula
 * over the base valuation. At most one valuation is appended per asset per
 * day. Returns the number of assets re-priced.
 */
export function refreshMarketValuations(ctx: AppContext, userId?: number): number {
  const today = todayISO(ctx.now);
  const rows = ctx.db
    .prepare(
      `SELECT id, user_id, valuation_mode, market_symbol, quantity, country, manufacture_date FROM assets
       WHERE valuation_mode != 'manual'${userId ? ' AND user_id = ?' : ''}`,
    )
    .all(...(userId ? [userId] : [])) as unknown as AutoValuedRow[];
  if (rows.length === 0) return 0;

  let updated = 0;
  const touchedUsers = new Set<number>();
  withTransaction(ctx.db, () => {
    const alreadyToday = ctx.db.prepare(
      `SELECT 1 FROM asset_valuations
       WHERE asset_id = ? AND source = 'market' AND recorded_at >= ? AND recorded_at <= ?
       LIMIT 1`,
    );
    const firstValuation = ctx.db.prepare(
      `SELECT value_minor, recorded_at FROM asset_valuations
       WHERE asset_id = ? ORDER BY recorded_at, id LIMIT 1`,
    );
    const insert = ctx.db.prepare(
      `INSERT INTO asset_valuations (asset_id, value_minor, source, recorded_at)
       VALUES (?, ?, 'market', ?)`,
    );
    const valueToday = (row: AutoValuedRow): number | null => {
      if (row.valuation_mode === 'market') {
        const price = ctx.prices.getPriceMinor(row.market_symbol!, today);
        return price === null ? null : holdingValueMinor(price, row.quantity!);
      }
      const base = firstValuation.get(row.id) as
        | { value_minor: number; recorded_at: string }
        | undefined;
      if (!base) return null;
      const baseDate = base.recorded_at.slice(0, 10);
      if (row.valuation_mode === 'property_index') {
        const rate = PROPERTY_COUNTRIES[row.country ?? '']?.annualRatePct;
        return rate === undefined
          ? null
          : propertyValueMinor(base.value_minor, baseDate, today, rate);
      }
      if (!row.manufacture_date) return null;
      return vehicleValueMinor(base.value_minor, baseDate, row.manufacture_date, today);
    };
    for (const row of rows) {
      if (alreadyToday.get(row.id, `${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`)) continue;
      const value = valueToday(row);
      if (value === null) continue; // unpriceable today — try again tomorrow
      insert.run(row.id, value, ctx.now().toISOString());
      touchedUsers.add(row.user_id);
      updated++;
    }
    for (const uid of touchedUsers) upsertSnapshot(ctx.db, uid, today);
  });
  return updated;
}
