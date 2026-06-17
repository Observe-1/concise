import type { AppContext } from '../../context.js';
import type {
  AssetCategory, HoldingChangeDto, HoldingDto, HoldingDetailDto, Metal, ValuationDto, ValuationMode, ValuationSource,
} from '../../types/api.js';
import { ASSET_VALUATION_MODES } from '../../types/api.js';
import type { HoldingKind } from './kind.js';
import { withTransaction } from '../../db/connection.js';
import { badRequest, notFound } from '../../lib/http.js';
import { addDays, rangeStart, todayISO, type HistoryRange } from '../../lib/dates.js';
import { PROPERTY_COUNTRIES, propertyValueMinor, vehicleValueMinor } from '../market/models.js';
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
  manufacture_date?: string | null;
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
  manufactureDate?: string;
  /** Optional backdate (YYYY-MM-DD): records the first valuation on this past date. */
  asOf?: string;
  /**
   * Optional present-day value for a backdated, non-market holding: recorded as
   * a second valuation today, in addition to the historic value at `asOf`. For
   * vehicle depreciation it becomes the anchor (the historic value is then
   * ignored — see createHolding).
   */
  presentValueMinor?: number;
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
  manufactureDate?: string | null;
}

/** With `withCutoff`, the value subqueries each take a cutoff timestamp
 *  parameter so a holding reads as of a past moment (historical view). */
function selectColumns(k: HoldingKind, withCutoff = false): string {
  const marketCols = k.supportsMarket
    ? 'h.metal, h.valuation_mode, h.market_symbol, h.quantity, h.country, h.manufacture_date, h.history_price_missing,'
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
    manufactureDate: row.manufacture_date ?? null,
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

/**
 * Percent change of every holding's value over a range, ending at the
 * reference date (asOf in historical view, otherwise today). The base is the
 * latest valuation on or before the period start; ALL/MAX measures from the
 * holding's first valuation. Returns null when the holding had no value at
 * the period start (it didn't exist yet) or the base was zero.
 */
export function holdingChanges(
  ctx: AppContext,
  k: HoldingKind,
  userId: number,
  range: HistoryRange,
  asOfISO?: string,
): HoldingChangeDto[] {
  const ref = asOfISO ?? todayISO(ctx.now);
  const start = rangeStart(range, ref);
  const valueAt = ctx.db.prepare(
    `SELECT value_minor FROM ${k.valuationTable}
     WHERE ${k.fk} = ? AND recorded_at <= ?
     ORDER BY recorded_at DESC, id DESC LIMIT 1`,
  );
  const earliest = ctx.db.prepare(
    `SELECT value_minor FROM ${k.valuationTable}
     WHERE ${k.fk} = ? ORDER BY recorded_at, id LIMIT 1`,
  );
  const ids = ctx.db
    .prepare(`SELECT id FROM ${k.table} WHERE user_id = ? ORDER BY id`)
    .all(userId) as { id: number }[];
  const refCutoff = `${ref}T23:59:59.999Z`;
  return ids.map(({ id }): HoldingChangeDto => {
    const end = valueAt.get(id, refCutoff) as { value_minor: number } | undefined;
    if (!end) return { id, changePct: null };
    const base = (start
      ? valueAt.get(id, `${start}T23:59:59.999Z`)
      : earliest.get(id)) as { value_minor: number } | undefined;
    if (!base || base.value_minor === 0) return { id, changePct: null };
    const pct = ((end.value_minor - base.value_minor) / base.value_minor) * 100;
    return { id, changePct: Math.round(pct * 100) / 100 };
  });
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

/** Validate a depreciation manufacture date (needed to derive vehicle age). */
function requireManufactureDate(raw: string | null | undefined, today: string): string {
  if (!raw) throw badRequest('A manufacture date is required for the depreciation method');
  if (raw > today) throw badRequest('Manufacture date cannot be in the future');
  return raw;
}

/**
 * Anchor a model method (property index / depreciation) grows from: the most
 * recent value the user typed in (latest `source='manual'` valuation).
 * "Update value" appends a manual valuation, so this re-bases all future
 * automatic calculations on the new number while the historical entries are
 * left untouched. Falls back to the earliest valuation of any source if (only
 * defensively — model holdings always have a manual base) no manual entry
 * exists.
 */
function modelAnchor(
  ctx: AppContext,
  k: HoldingKind,
  holdingId: number,
): { value_minor: number; recorded_at: string } | undefined {
  const manual = ctx.db
    .prepare(
      `SELECT value_minor, recorded_at FROM ${k.valuationTable}
       WHERE ${k.fk} = ? AND source = 'manual' ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    )
    .get(holdingId) as { value_minor: number; recorded_at: string } | undefined;
  if (manual) return manual;
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
    const manufactureDate = mode === 'depreciation'
      ? requireManufactureDate(input.manufactureDate, today)
      : null;
    let id: number;
    if (k.supportsMarket) {
      id = ctx.db
        .prepare(
          `INSERT INTO assets (user_id, category, name, notes, metal, valuation_mode, market_symbol, quantity, country, manufacture_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId, input.category, input.name, input.notes ?? null,
          input.category === 'precious_metals' ? input.metal ?? null : null,
          mode,
          isMarket ? input.marketSymbol!.toUpperCase() : null,
          isMarket ? input.quantity! : null,
          country,
          manufactureDate,
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
    // methods (property index / depreciation) likewise backfill one value per
    // day. A backdated, non-market entry may also carry a present-day value —
    // recorded as a second valuation today, in addition to the historic one.
    const start = input.asOf && input.asOf < today ? input.asOf : null;
    const present = !isMarket && start ? input.presentValueMinor : undefined;
    if (isMarket) {
      if (start) {
        const { missing, inserted } = backfillMarketValuations(
          ctx, k, id, input.marketSymbol!.toUpperCase(), input.quantity!, start, today,
        );
        if (inserted === 0) {
          throw badRequest(`No price history available for ${input.marketSymbol!.toUpperCase()}`);
        }
        if (missing) {
          ctx.db.prepare('UPDATE assets SET history_price_missing = 1 WHERE id = ?').run(id);
        }
      } else {
        insertValuation(ctx, k, id, marketValue(ctx, input.marketSymbol!, input.quantity!), 'market');
      }
    } else if (mode === 'depreciation' && start && present !== undefined) {
      // Special rule: when a present-day value is given, vehicle depreciation is
      // anchored on it (today) and the historic value is not used. The past is
      // reconstructed by reversing the depreciation curve from today's value
      // back to each day; today itself is the re-anchorable manual base.
      backfillModelValuations(
        ctx, k, id, start, addDays(today, -1),
        (d) => vehicleValueMinor(present, today, manufactureDate!, d),
      );
      insertValuation(ctx, k, id, present, 'manual');
    } else if (mode === 'property_index' || mode === 'depreciation') {
      const base = input.valueMinor ?? 0;
      insertValuation(ctx, k, id, base, 'manual', start ? `${start}T12:00:00.000Z` : undefined);
      if (start) {
        const valueOn = mode === 'property_index'
          ? (d: string) => propertyValueMinor(base, start, d, PROPERTY_COUNTRIES[country!]!.annualRatePct)
          : (d: string) => vehicleValueMinor(base, start, manufactureDate!, d);
        // A present-day value re-anchors today, so the model backfill stops the
        // day before and the present value is recorded as today's manual base.
        backfillModelValuations(
          ctx, k, id, addDays(start, 1), present !== undefined ? addDays(today, -1) : today, valueOn,
        );
        if (present !== undefined) insertValuation(ctx, k, id, present, 'manual');
      }
    } else {
      // Manual asset, or any liability.
      insertValuation(
        ctx, k, id, input.valueMinor ?? 0, 'manual',
        start ? `${start}T12:00:00.000Z` : undefined,
      );
      // A backdated manual entry with a present-day value records it today too,
      // so the graph ramps from the historic figure to the current one.
      if (start && present !== undefined) insertValuation(ctx, k, id, present, 'manual');
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
      const today = todayISO(ctx.now);
      const manufactureDate = mode === 'depreciation'
        ? requireManufactureDate(
            patch.manufactureDate !== undefined ? patch.manufactureDate : existing.manufacture_date ?? null,
            today,
          )
        : null;
      ctx.db
        .prepare(
          `UPDATE assets SET name = ?, category = ?, notes = ?, metal = ?, valuation_mode = ?,
             market_symbol = ?, quantity = ?, country = ?, manufacture_date = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, category, notes,
          category === 'precious_metals' ? metal : null,
          mode,
          mode === 'market' ? symbol : null,
          mode === 'market' ? quantity : null,
          country,
          manufactureDate,
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
      // Turning a model method on (or changing its inputs) revalues today
      // from the base valuation under the new model.
      const modelInputsChanged =
        (mode === 'property_index' &&
          (mode !== (existing.valuation_mode ?? 'manual') || country !== (existing.country ?? null))) ||
        (mode === 'depreciation' &&
          (mode !== (existing.valuation_mode ?? 'manual') ||
            manufactureDate !== (existing.manufacture_date ?? null)));
      if (modelInputsChanged) {
        const base = modelAnchor(ctx, k, id);
        if (base) {
          const baseDate = base.recorded_at.slice(0, 10);
          const value = mode === 'property_index'
            ? propertyValueMinor(base.value_minor, baseDate, today, PROPERTY_COUNTRIES[country!]!.annualRatePct)
            : vehicleValueMinor(base.value_minor, baseDate, manufactureDate!, today);
          insertValuation(ctx, k, id, value, 'market');
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
    // A manual revaluation after a gap is smoothed across the gap on the
    // graph, so the snapshots since the previous entry must be recomputed —
    // not just today's.
    const prev = ctx.db
      .prepare(
        `SELECT recorded_at FROM ${k.valuationTable}
         WHERE ${k.fk} = ? ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      )
      .get(id) as { recorded_at: string } | undefined;
    insertValuation(ctx, k, id, valueMinor, 'manual');
    const today = todayISO(ctx.now);
    const prevDate = prev?.recorded_at.slice(0, 10);
    if (prevDate && prevDate < today) {
      recomputeSnapshotRange(ctx.db, userId, prevDate, today);
    } else {
      refreshTodaySnapshot(ctx, userId);
    }
    return toDto(getRow(ctx, k, userId, id));
  });
}
