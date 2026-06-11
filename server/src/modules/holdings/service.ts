import type { AppContext } from '../../context.js';
import type { HoldingDto, HoldingDetailDto, Metal, ValuationDto, ValuationSource } from '../../types/api.js';
import type { HoldingKind } from './kind.js';
import { withTransaction } from '../../db/connection.js';
import { notFound } from '../../lib/http.js';
import { todayISO } from '../../lib/dates.js';
import { holdingValueMinor } from '../market/provider.js';
import { refreshTodaySnapshot } from '../snapshots/service.js';

interface HoldingRow {
  id: number;
  category: string;
  name: string;
  notes: string | null;
  metal?: Metal | null;
  valuation_mode?: 'manual' | 'market';
  market_symbol?: string | null;
  quantity?: number | null;
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
  valuationMode?: 'manual' | 'market';
  marketSymbol?: string;
  quantity?: number;
}

export interface UpdateHoldingInput {
  category?: string;
  name?: string;
  notes?: string | null;
  metal?: Metal | null;
  valuationMode?: 'manual' | 'market';
  marketSymbol?: string | null;
  quantity?: number | null;
}

function selectColumns(k: HoldingKind): string {
  const marketCols = k.supportsMarket
    ? 'h.metal, h.valuation_mode, h.market_symbol, h.quantity,'
    : '';
  return `
    SELECT h.id, h.category, h.name, h.notes, ${marketCols} h.created_at,
      (SELECT v.value_minor FROM ${k.valuationTable} v WHERE v.${k.fk} = h.id
       ORDER BY v.recorded_at DESC, v.id DESC LIMIT 1) AS current_value_minor,
      (SELECT v.recorded_at FROM ${k.valuationTable} v WHERE v.${k.fk} = h.id
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
    currentValueMinor: row.current_value_minor ?? 0,
    lastValuedAt: row.last_valued_at ?? row.created_at,
    createdAt: row.created_at,
  };
}

export function listHoldings(ctx: AppContext, k: HoldingKind, userId: number): HoldingDto[] {
  const rows = ctx.db
    .prepare(`${selectColumns(k)} WHERE h.user_id = ? ORDER BY h.category, h.name, h.id`)
    .all(userId) as unknown as HoldingRow[];
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
): void {
  ctx.db
    .prepare(
      `INSERT INTO ${k.valuationTable} (${k.fk}, value_minor, source, recorded_at) VALUES (?, ?, ?, ?)`,
    )
    .run(holdingId, valueMinor, source, ctx.now().toISOString());
}

/** Initial value for a market-mode holding comes from the price provider. */
function marketValue(ctx: AppContext, symbol: string, quantity: number): number {
  return holdingValueMinor(ctx.prices.getPriceMinor(symbol, todayISO(ctx.now)), quantity);
}

export function createHolding(
  ctx: AppContext,
  k: HoldingKind,
  userId: number,
  input: CreateHoldingInput,
): HoldingDto {
  return withTransaction(ctx.db, () => {
    const isMarket = k.supportsMarket && input.valuationMode === 'market';
    let id: number;
    if (k.supportsMarket) {
      id = ctx.db
        .prepare(
          `INSERT INTO assets (user_id, category, name, notes, metal, valuation_mode, market_symbol, quantity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId, input.category, input.name, input.notes ?? null,
          input.category === 'precious_metals' ? input.metal ?? null : null,
          isMarket ? 'market' : 'manual',
          isMarket ? input.marketSymbol!.toUpperCase() : null,
          isMarket ? input.quantity! : null,
        ).lastInsertRowid as number;
    } else {
      id = ctx.db
        .prepare('INSERT INTO liabilities (user_id, category, name, notes) VALUES (?, ?, ?, ?)')
        .run(userId, input.category, input.name, input.notes ?? null).lastInsertRowid as number;
    }
    const value = isMarket
      ? marketValue(ctx, input.marketSymbol!, input.quantity!)
      : input.valueMinor ?? 0;
    insertValuation(ctx, k, id, value, isMarket ? 'market' : 'manual');
    refreshTodaySnapshot(ctx, userId);
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
      const symbol =
        patch.marketSymbol !== undefined
          ? patch.marketSymbol?.toUpperCase() ?? null
          : existing.market_symbol ?? null;
      const quantity = patch.quantity !== undefined ? patch.quantity : existing.quantity ?? null;
      const metal = patch.metal !== undefined ? patch.metal : existing.metal ?? null;
      ctx.db
        .prepare(
          `UPDATE assets SET name = ?, category = ?, notes = ?, metal = ?, valuation_mode = ?,
             market_symbol = ?, quantity = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, category, notes,
          category === 'precious_metals' ? metal : null,
          mode,
          mode === 'market' ? symbol : null,
          mode === 'market' ? quantity : null,
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
