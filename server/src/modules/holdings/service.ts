import type { AppContext } from '../../context.js';
import type {
  AssetCategory, HoldingDto, HoldingDetailDto, Metal, ValuationDto, ValuationMode, ValuationSource,
} from '../../types/api.js';
import { ASSET_VALUATION_MODES } from '../../types/api.js';
import type { HoldingKind } from './kind.js';
import { withTransaction } from '../../db/connection.js';
import { badRequest, notFound } from '../../lib/http.js';
import { addDays, todayISO } from '../../lib/dates.js';
import { PROPERTY_COUNTRIES, propertyValueMinor } from '../market/models.js';
import { holdingValueMinor } from '../market/provider.js';
import { recomputeSnapshotRange, refreshTodaySnapshot } from '../snapshots/service.js';

interface HoldingRow {
  id: number;
  category: string;
  name: string;
  notes: string | null;
  metal?: Metal | null;
  valuation_mode?: ValuationMode;
  market_symbol?: string | null;
  quantity?: number | null;
  country?: string | null;
  history_price_missing?: number;
  created_at: string;
  current_value_minor: number | null;
  last_valued_at: string | null;
}

export interface CreateHoldingInput {
  category: string;
  name: string;
  notes?: string | null;
  metal?: Metal | null;
  valueMinor?: number;
  valuationMode?: ValuationMode;
  marketSymbol?: string;
  quantity?: number;
  country?: string;
  /** Optional backdate (YYYY-MM-DD): records the first valuation on this past date. */
  asOf?: string;
}

export interface UpdateHoldingInput {
  category?: string;
  name?: string;
  notes?: string | null;
  metal?: Metal | null;
  valuationMode?: ValuationMode;
  marketSymbol?: string | null;
  quantity?: number | null;
  country?: string | null;
}

/** With `withCutoff`, the value subqueries each take a cutoff timestamp
 *  parameter so a holding reads as of a past moment (historical view). */
function selectColumns(k: HoldingKind, withCutoff = false): string {
  const marketCols = k.supportsMarket
    ? 'h.metal, h.valuation_mode, h.market_symbol, h.quantity, h.country, h.history_price_missing,'
    : '';
  const cutoff = withCutoff ? ' AND v.recorded_at <= ?' : '';
  return `
    SELECT h.id, h.category, h.name, h.notes, ${marketCols} h.created_at,
      (SELECT v.value_minor FROM ${k.valuationTable} v WHERE v.${k.fk} = h.id${cutoff}
       ORDER BY v.recorded_at DESC, v.id DESC LIMIT 1) AS current_value_minor,
      (SELECT v.recorded_at FROM ${k.valuationTable} v WHERE v.${k.fk} = h.id${cutoff}
       ORDER BY v.recorded_at DESC, v.id DESC LIMIT 1) AS last_valued_at
    FROM ${k.table} h`;
}

function toDto(row: HoldingRow): HoldingDto {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    notes: row.notes,
    metal: row.metal ?? null,
    valuationMode: row.valuation_mode ?? 'manual',
    marketSymbol: row.market_symbol ?? null,
    quantity: row.quantity ?? null,
    country: row.country ?? null,
    historicalPriceMissing: row.history_price_missing === 1,
    currentValueMinor: row.current_value_minor ?? 0,
    lastValuedAt: row.last_valued_at ?? row.created_at,
    createdAt: row.created_at,
  };
}

/**
 * List holdings, optionally as of the end of a past day (historical view):
 * values come from the latest valuation on or before that day, and entries
 * whose history starts later are omitted entirely — the portfolio reads
 * exactly as it stood on that date.
 */
export function listHoldings(
  ctx: AppContext,
  k: HoldingKind,
  userId: number,
  asOfISO?: string,
): HoldingDto[] {
  if (!asOfISO) {
    const rows = ctx.db
      .prepare(`${selectColumns(k)} WHERE h.user_id = ? ORDER BY h.category, h.name, h.id`)
      .all(userId) as unknown as HoldingRow[];
    return rows.map(toDto);
  }
  const cutoff = `${asOfISO}T23:59:59.999Z`;
  const rows = ctx.db
    .prepare(
      `${selectColumns(k, true)}
       WHERE h.user_id = ?
         AND EXISTS (SELECT 1 FROM ${k.valuationTable} v
                     WHERE v.${k.fk} = h.id AND v.recorded_at <= ?)
       ORDER BY h.category, h.name, h.id`,
    )
    .all(cutoff, cutoff, userId, cutoff) as unknown as HoldingRow[];
  return rows.map(toDto);
}

function getRow(ctx: AppContext, k: HoldingKind, userId: number, id: number): HoldingRow {
  const row = ctx.db
    .prepare(`${selectColumns(k)} WHERE h.user_id = ? AND h.id = ?`)
    .get(userId, id) as unknown as HoldingRow | undefined;
  if (!row) throw notFound(`${k.kind} not found`);
  return row;
}

export function getHolding(ctx: AppContext, k: HoldingKind, userId: number, id: number): HoldingDetailDto {
  const row = getRow(ctx, k, userId, id);
  const valuations = ctx.db
    .prepare(
      `SELECT id, value_minor, source, recorded_at FROM ${k.valuationTable}
       WHERE ${k.fk} = ? ORDER BY recorded_at DESC, id DESC LIMIT 500`,
    )
    .all(id) as unknown as { id: number; value_minor: number; source: ValuationSource; recorded_at: string }[];
  return {
    ...toDto(row),
    valuations: valuations.map((v): ValuationDto => ({
      id: v.id,
      valueMinor: v.value_minor,
      source: v.source,
      recordedAt: v.recorded_at,
    })),
  };
}

function insertValuation(
  ctx: AppContext,
  k: HoldingKind,
  holdingId: number,
  valueMinor: number,
  source: ValuationSource,
  recordedAt?: string,
): void {
  ctx.db
    .prepare(
      `INSERT INTO ${k.valuationTable} (${k.fk}, value_minor, source, recorded_at) VALUES (?, ?, ?, ?)`,
    )
    .run(holdingId, valueMinor, source, recordedAt ?? ctx.now().toISOString());
}

/** Some categories restrict how they may be valued (cash is manual-only). */
function assertModeAllowed(category: string, mode: string): void {
  const allowed = ASSET_VALUATION_MODES[category as AssetCategory] ?? ['manual'];
  if (!allowed.includes(mode as (typeof allowed)[number])) {
    throw badRequest(`The ${mode} valuation method is not available for ${category} entries`);
  }
}

/** Validate and normalise a property-index country code. */
function requireCountry(raw: string | null | undefined): string {
  const code = raw?.trim().toUpperCase();
  if (!code || !PROPERTY_COUNTRIES[code]) {
    throw badRequest('A supported country is required for the property index method');
  }
  return code;
}

/** Earliest valuation of a holding — the base point model methods grow from. */
function firstValuation(
  ctx: AppContext,
  k: HoldingKind,
  holdingId: number,
): { value_minor: number; recorded_at: string } | undefined {
  return ctx.db
    .prepare(
      `SELECT value_minor, recorded_at FROM ${k.valuationTable}
       WHERE ${k.fk} = ? ORDER BY recorded_at, id LIMIT 1`,
    )
    .get(holdingId) as { value_minor: number; recorded_at: string } | undefined;
}

/** One model-derived valuation per day over [fromISO, toISO]. */
function backfillModelValuations(
  ctx: AppContext,
  k: HoldingKind,
  holdingId: number,
  fromISO: string,
  toISO: string,
  valueOn: (dateISO: string) => number,
): void {
  for (let d = fromISO; d <= toISO; d = addDays(d, 1)) {
    insertValuation(ctx, k, holdingId, Math.max(0, valueOn(d)), 'market', `${d}T12:00:00.000Z`);
  }
}

/**
 * Value of a market-mode holding from the price provider, as of a date.
 * Throws when the provider has no price for that date — callers that can
 * tolerate gaps (historical backfill) query the provider directly instead.
 */
function marketValue(ctx: AppContext, symbol: string, quantity: number, dateISO?: string): number {
  const date = dateISO ?? todayISO(ctx.now);
  const price = ctx.prices.getPriceMinor(symbol, date);
  if (price === null) throw badRequest(`No price available for ${symbol.toUpperCase()} on ${date}`);
  return holdingValueMinor(price, quantity);
}

/**
 * Backfill one market valuation per day over [fromISO, toISO] so a backdated
 * holding is accurate for every date, not flat at its starting price. Days
 * the provider cannot price are skipped; returns true when any were, so the
 * holding can be flagged as historically incomplete.
 */
function backfillMarketValuations(
  ctx: AppContext,
  k: HoldingKind,
  holdingId: number,
  symbol: string,
  quantity: number,
  fromISO: string,
  toISO: string,
): { missing: boolean; inserted: number } {
  let missing = false;
  let inserted = 0;
  for (let d = fromISO; d <= toISO; d = addDays(d, 1)) {
    const price = ctx.prices.getPriceMinor(symbol, d);
    if (price === null) {
      missing = true;
      continue;
    }
    insertValuation(ctx, k, holdingId, holdingValueMinor(price, quantity), 'market', `${d}T12:00:00.000Z`);
    inserted++;
  }
  return { missing, inserted };
}

export function createHolding(
  ctx: AppContext,
  k: HoldingKind,
  userId: number,
  input: CreateHoldingInput,
): HoldingDto {
  const today = todayISO(ctx.now);
  if (input.asOf && input.asOf > today) throw badRequest('Backdate cannot be in the future');
  return withTransaction(ctx.db, () => {
    const mode: ValuationMode = k.supportsMarket ? input.valuationMode ?? 'manual' : 'manual';
    if (k.supportsMarket) assertModeAllowed(input.category, mode);
    const isMarket = mode === 'market';
    const country = mode === 'property_index' ? requireCountry(input.country) : null;
    let id: number;
    if (k.supportsMarket) {
      id = ctx.db
        .prepare(
          `INSERT INTO assets (user_id, category, name, notes, metal, valuation_mode, market_symbol, quantity, country)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId, input.category, input.name, input.notes ?? null,
          input.category === 'precious_metals' ? input.metal ?? null : null,
          mode,
          isMarket ? input.marketSymbol!.toUpperCase() : null,
          isMarket ? input.quantity! : null,
          country,
        ).lastInsertRowid as number;
    } else {
      id = ctx.db
        .prepare('INSERT INTO liabilities (user_id, category, name, notes) VALUES (?, ?, ?, ?)')
        .run(userId, input.category, input.name, input.notes ?? null).lastInsertRowid as number;
    }
    // Backdated entries start their history on the chosen past date and the
    // snapshot history is recomputed from there. Backdated market entries
    // are priced per day over the whole period (not flat at one old price);
    // days the provider has no data for flag the holding instead. Model
    // methods (property index) likewise backfill one value per day.
    const start = input.asOf && input.asOf < today ? input.asOf : null;
    if (isMarket && start) {
      const { missing, inserted } = backfillMarketValuations(
        ctx, k, id, input.marketSymbol!.toUpperCase(), input.quantity!, start, today,
      );
      if (inserted === 0) {
        throw badRequest(`No price history available for ${input.marketSymbol!.toUpperCase()}`);
      }
      if (missing) {
        ctx.db.prepare('UPDATE assets SET history_price_missing = 1 WHERE id = ?').run(id);
      }
    } else if (mode === 'property_index') {
      const base = input.valueMinor ?? 0;
      insertValuation(ctx, k, id, base, 'manual', start ? `${start}T12:00:00.000Z` : undefined);
      if (start) {
        const rate = PROPERTY_COUNTRIES[country!]!.annualRatePct;
        backfillModelValuations(ctx, k, id, addDays(start, 1), today,
          (d) => propertyValueMinor(base, start, d, rate));
      }
    } else {
      const value = isMarket
        ? marketValue(ctx, input.marketSymbol!, input.quantity!)
        : input.valueMinor ?? 0;
      insertValuation(
        ctx, k, id, value, isMarket ? 'market' : 'manual',
        start ? `${start}T12:00:00.000Z` : undefined,
      );
    }
    if (start) {
      recomputeSnapshotRange(ctx.db, userId, start, today);
    } else {
      refreshTodaySnapshot(ctx, userId);
    }
    return toDto(getRow(ctx, k, userId, id));
  });
}

export function updateHolding(
  ctx: AppContext,
  k: HoldingKind,
  userId: number,
  id: number,
  patch: UpdateHoldingInput,
): HoldingDto {
  return withTransaction(ctx.db, () => {
    const existing = getRow(ctx, k, userId, id);
    const nowIso = ctx.now().toISOString();

    const name = patch.name ?? existing.name;
    const category = patch.category ?? existing.category;
    const notes = patch.notes !== undefined ? patch.notes : existing.notes;

    if (k.supportsMarket) {
      const mode = patch.valuationMode ?? existing.valuation_mode ?? 'manual';
      assertModeAllowed(category, mode);
      const symbol =
        patch.marketSymbol !== undefined
          ? patch.marketSymbol?.toUpperCase() ?? null
          : existing.market_symbol ?? null;
      const quantity = patch.quantity !== undefined ? patch.quantity : existing.quantity ?? null;
      const metal = patch.metal !== undefined ? patch.metal : existing.metal ?? null;
      const country = mode === 'property_index'
        ? requireCountry(patch.country !== undefined ? patch.country : existing.country ?? null)
        : null;
      ctx.db
        .prepare(
          `UPDATE assets SET name = ?, category = ?, notes = ?, metal = ?, valuation_mode = ?,
             market_symbol = ?, quantity = ?, country = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, category, notes,
          category === 'precious_metals' ? metal : null,
          mode,
          mode === 'market' ? symbol : null,
          mode === 'market' ? quantity : null,
          country,
          nowIso, id);
      const marketInputsChanged =
        mode === 'market' &&
        (mode !== (existing.valuation_mode ?? 'manual') ||
          symbol !== (existing.market_symbol ?? null) ||
          quantity !== (existing.quantity ?? null));
      if (marketInputsChanged && symbol && quantity) {
        insertValuation(ctx, k, id, marketValue(ctx, symbol, quantity), 'market');
        refreshTodaySnapshot(ctx, userId);
      }
      // Turning the property index on (or changing country) revalues today
      // from the base valuation under the new model.
      const propertyInputsChanged =
        mode === 'property_index' &&
        (mode !== (existing.valuation_mode ?? 'manual') || country !== (existing.country ?? null));
      if (propertyInputsChanged) {
        const base = firstValuation(ctx, k, id);
        if (base) {
          const rate = PROPERTY_COUNTRIES[country!]!.annualRatePct;
          insertValuation(ctx, k, id,
            propertyValueMinor(base.value_minor, base.recorded_at.slice(0, 10), todayISO(ctx.now), rate),
            'market');
          refreshTodaySnapshot(ctx, userId);
        }
      }
    } else {
      ctx.db
        .prepare(`UPDATE liabilities SET name = ?, category = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .run(name, category, notes, nowIso, id);
    }
    return toDto(getRow(ctx, k, userId, id));
  });
}

export function deleteHolding(ctx: AppContext, k: HoldingKind, userId: number, id: number): void {
  withTransaction(ctx.db, () => {
    getRow(ctx, k, userId, id); // 404 if not owned
    ctx.db.prepare(`DELETE FROM ${k.table} WHERE id = ?`).run(id);
    refreshTodaySnapshot(ctx, userId);
  });
}

export function addValuation(
  ctx: AppContext,
  k: HoldingKind,
  userId: number,
  id: number,
  valueMinor: number,
): HoldingDto {
  return withTransaction(ctx.db, () => {
    getRow(ctx, k, userId, id);
    insertValuation(ctx, k, id, valueMinor, 'manual');
    refreshTodaySnapshot(ctx, userId);
    return toDto(getRow(ctx, k, userId, id));
  });
}
