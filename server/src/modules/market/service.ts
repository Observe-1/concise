import type { AppContext } from '../../context.js';
import type { SymbolLookupDto } from '../../types/api.js';
import { withTransaction } from '../../db/connection.js';
import { todayISO } from '../../lib/dates.js';
import { convertMinor } from '../../lib/fx.js';
import { upsertSnapshot } from '../snapshots/service.js';
import { PROPERTY_COUNTRIES, propertyValueMinor, vehicleValueMinor } from './models.js';
import { holdingValueMinor } from './provider.js';

interface DiscoveredInstrumentRow {
  symbol: string;
  isin: string;
  name: string;
  currency: string;
  exchange: string;
}

/**
 * Resolve an ISIN to its instrument, checking the shared `discovered_instruments`
 * cache first so a fund only ever costs one provider round-trip across all
 * users. On a fresh resolution, persists the result and registers it with the
 * price provider so it's immediately priceable.
 */
export async function resolveIsinCached(ctx: AppContext, isin: string): Promise<SymbolLookupDto | null> {
  const cached = ctx.db
    .prepare('SELECT * FROM discovered_instruments WHERE isin = ?')
    .get(isin) as DiscoveredInstrumentRow | undefined;
  if (cached) {
    ctx.prices.registerInstrument(cached.symbol, {
      name: cached.name, currency: cached.currency, exchange: cached.exchange,
    });
    return { symbol: cached.symbol, name: cached.name, currency: cached.currency, exchange: cached.exchange };
  }
  const resolved = await ctx.prices.resolveIsin(isin);
  if (!resolved) return null;
  ctx.db
    .prepare(
      `INSERT INTO discovered_instruments (symbol, isin, name, currency, exchange) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO NOTHING`,
    )
    .run(resolved.symbol, isin, resolved.name, resolved.currency, resolved.exchange);
  ctx.prices.registerInstrument(resolved.symbol, {
    name: resolved.name, currency: resolved.currency, exchange: resolved.exchange,
  });
  return resolved;
}

/** Restore the price provider's in-memory registry of previously-discovered
 *  (ISIN-resolved) instruments after a restart. Call once at startup. */
export function hydrateDiscoveredInstruments(ctx: AppContext): void {
  const rows = ctx.db.prepare('SELECT * FROM discovered_instruments').all() as unknown as DiscoveredInstrumentRow[];
  for (const row of rows) {
    ctx.prices.registerInstrument(row.symbol, { name: row.name, currency: row.currency, exchange: row.exchange });
  }
}

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
export async function refreshMarketValuations(ctx: AppContext, userId?: number): Promise<number> {
  const today = todayISO(ctx.now);
  const rows = ctx.db
    .prepare(
      `SELECT id, user_id, valuation_mode, market_symbol, quantity, country, manufacture_date FROM assets
       WHERE valuation_mode != 'manual'${userId ? ' AND user_id = ?' : ''}`,
    )
    .all(...(userId ? [userId] : [])) as unknown as AutoValuedRow[];
  if (rows.length === 0) return 0;

  // Fetch today's real prices for every market holding up front (a no-op for
  // the simulated provider), so the synchronous valuation transaction below
  // reads from a warm cache. Must happen outside the transaction.
  const symbols = rows.filter((r) => r.valuation_mode === 'market' && r.market_symbol).map((r) => r.market_symbol!);
  if (symbols.length > 0) await ctx.prices.prime(symbols, today, today);

  // Likewise prime live FX rates for every currency the conversions below
  // might need: each instrument's quote currency, plus every affected user's
  // display currency.
  const instrumentCurrencies = symbols.map((s) => ctx.prices.instrumentCurrency(s));
  const affectedUserIds = [...new Set(rows.map((r) => r.user_id))];
  const userCurrencyRows = ctx.db
    .prepare(`SELECT DISTINCT currency FROM settings WHERE user_id IN (${affectedUserIds.map(() => '?').join(',')})`)
    .all(...affectedUserIds) as { currency: string }[];
  await ctx.prices.primeFxRates([...instrumentCurrencies, ...userCurrencyRows.map((r) => r.currency)]);

  let updated = 0;
  const touchedUsers = new Set<number>();
  withTransaction(ctx.db, () => {
    const alreadyToday = ctx.db.prepare(
      `SELECT 1 FROM asset_valuations
       WHERE asset_id = ? AND source = 'market' AND recorded_at >= ? AND recorded_at <= ?
       LIMIT 1`,
    );
    // A model method grows from the latest value the user typed in, so an
    // "update value" re-bases future calculations on the new number (history
    // is left intact). Falls back to the earliest valuation if there is no
    // manual entry — model holdings always have a manual base, so this only
    // matters defensively.
    const latestManual = ctx.db.prepare(
      `SELECT value_minor, recorded_at FROM asset_valuations
       WHERE asset_id = ? AND source = 'manual' ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    );
    const earliest = ctx.db.prepare(
      `SELECT value_minor, recorded_at FROM asset_valuations
       WHERE asset_id = ? ORDER BY recorded_at, id LIMIT 1`,
    );
    const insert = ctx.db.prepare(
      `INSERT INTO asset_valuations (asset_id, value_minor, source, recorded_at)
       VALUES (?, ?, 'market', ?)`,
    );
    // Each user's display currency (cached) — market prices arrive in the
    // instrument's currency and are converted into it before storage.
    const ccyCache = new Map<number, string>();
    const userCcy = (uid: number): string => {
      let c = ccyCache.get(uid);
      if (c === undefined) {
        const row = ctx.db.prepare('SELECT currency FROM settings WHERE user_id = ?').get(uid) as
          | { currency: string }
          | undefined;
        c = row?.currency ?? 'USD';
        ccyCache.set(uid, c);
      }
      return c;
    };
    const valueToday = (row: AutoValuedRow): number | null => {
      if (row.valuation_mode === 'market') {
        const price = ctx.prices.getPriceMinor(row.market_symbol!, today);
        return price === null
          ? null
          : convertMinor(
              holdingValueMinor(price, row.quantity!),
              ctx.prices.instrumentCurrency(row.market_symbol!),
              userCcy(row.user_id),
              (c) => ctx.prices.fxRateLive(c),
            );
      }
      const base = (latestManual.get(row.id) ?? earliest.get(row.id)) as
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

/**
 * Warm the price cache for a user's market holdings over `[fromISO, toISO]`, so
 * a subsequent synchronous valuation or projection reads real prices rather
 * than the fallback. A no-op for the simulated provider. Never throws.
 */
export async function primeUserMarketPrices(
  ctx: AppContext,
  userId: number,
  fromISO: string,
  toISO: string,
): Promise<void> {
  const rows = ctx.db
    .prepare(
      `SELECT DISTINCT market_symbol FROM assets
       WHERE valuation_mode = 'market' AND market_symbol IS NOT NULL AND user_id = ?`,
    )
    .all(userId) as { market_symbol: string }[];
  if (rows.length > 0) await ctx.prices.prime(rows.map((r) => r.market_symbol), fromISO, toISO);
}
