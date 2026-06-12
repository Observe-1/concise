import type { AppContext } from '../../context.js';
import type { HistoryEntryDto, LegacySnapshotDto } from '../../types/api.js';
import { badRequest, notFound } from '../../lib/http.js';
import { todayISO } from '../../lib/dates.js';
import { recomputeSnapshotRange, upsertSnapshot } from '../snapshots/service.js';

/**
 * Legacy wealth: a user-entered "on X date my net worth was Y" point, stored
 * as a snapshot row with source='legacy'. Positive net worth is recorded as
 * assets, negative as liabilities, so graph series stay consistent.
 */
export function setLegacyWealth(
  ctx: AppContext,
  userId: number,
  date: string,
  netWorthMinor: number,
): LegacySnapshotDto {
  if (date >= todayISO(ctx.now)) {
    throw badRequest('Legacy wealth must be dated in the past — today is tracked automatically');
  }
  const assets = Math.max(netWorthMinor, 0);
  const liabilities = Math.max(-netWorthMinor, 0);
  ctx.db
    .prepare(
      `INSERT INTO snapshots (user_id, snapshot_date, assets_minor, liabilities_minor, net_worth_minor, source)
       VALUES (?, ?, ?, ?, ?, 'legacy')
       ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
         assets_minor = excluded.assets_minor,
         liabilities_minor = excluded.liabilities_minor,
         net_worth_minor = excluded.net_worth_minor,
         source = 'legacy'`,
    )
    .run(userId, date, assets, liabilities, netWorthMinor);
  return { date, netWorthMinor };
}

export function listLegacyWealth(ctx: AppContext, userId: number): LegacySnapshotDto[] {
  const rows = ctx.db
    .prepare(
      `SELECT snapshot_date AS date, net_worth_minor FROM snapshots
       WHERE user_id = ? AND source = 'legacy' ORDER BY snapshot_date DESC`,
    )
    .all(userId) as unknown as { date: string; net_worth_minor: number }[];
  return rows.map((r) => ({ date: r.date, netWorthMinor: r.net_worth_minor }));
}

// ---------- historic valuation entries ----------

// Table/column names per side — compile-time constants, never user input.
const SIDES = {
  asset: { table: 'asset_valuations', fk: 'asset_id', parent: 'assets' },
  liability: { table: 'liability_valuations', fk: 'liability_id', parent: 'liabilities' },
} as const;

export type EntrySide = keyof typeof SIDES;

interface EntryRow {
  id: number;
  holding_id: number;
  holding_name: string;
  category: string;
  value_minor: number;
  source: HistoryEntryDto['source'];
  recorded_at: string;
}

function entrySelect(side: EntrySide, filtered: boolean): string {
  const s = SIDES[side];
  return `
    SELECT v.id, v.${s.fk} AS holding_id, p.name AS holding_name, p.category,
           v.value_minor, v.source, v.recorded_at
    FROM ${s.table} v JOIN ${s.parent} p ON p.id = v.${s.fk}
    WHERE p.user_id = ?${filtered ? ` AND v.${s.fk} = ?` : ''}`;
}

function toEntryDto(side: EntrySide, row: EntryRow): HistoryEntryDto {
  return {
    id: row.id,
    side,
    holdingId: row.holding_id,
    holdingName: row.holding_name,
    category: row.category,
    valueMinor: row.value_minor,
    source: row.source,
    recordedAt: row.recorded_at,
  };
}

export interface EntryFilter {
  side?: EntrySide;
  holdingId?: number;
  limit?: number;
}

/** All valuation entries across the user's holdings, newest first. */
export function listHistoryEntries(
  ctx: AppContext,
  userId: number,
  filter: EntryFilter = {},
): HistoryEntryDto[] {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  const sides: EntrySide[] = filter.side ? [filter.side] : ['asset', 'liability'];
  const entries: HistoryEntryDto[] = [];
  for (const side of sides) {
    const params: (number | string)[] = [userId];
    if (filter.holdingId) params.push(filter.holdingId);
    params.push(limit);
    const rows = ctx.db
      .prepare(`${entrySelect(side, Boolean(filter.holdingId))}
                ORDER BY v.recorded_at DESC, v.id DESC LIMIT ?`)
      .all(...params) as unknown as EntryRow[];
    entries.push(...rows.map((r) => toEntryDto(side, r)));
  }
  entries.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : b.id - a.id));
  return entries.slice(0, limit);
}

function getOwnedEntry(ctx: AppContext, userId: number, side: EntrySide, id: number): EntryRow {
  const row = ctx.db
    .prepare(`${entrySelect(side, false)} AND v.id = ?`)
    .get(userId, id) as unknown as EntryRow | undefined;
  if (!row) throw notFound('Entry not found');
  return row;
}

export interface EntryPatch {
  valueMinor?: number;
  /** Move the entry to this date (recorded at noon UTC). */
  recordedOn?: string;
}

export function updateHistoryEntry(
  ctx: AppContext,
  userId: number,
  side: EntrySide,
  id: number,
  patch: EntryPatch,
): HistoryEntryDto {
  const today = todayISO(ctx.now);
  if (patch.recordedOn && patch.recordedOn > today) {
    throw badRequest('Entries cannot be dated in the future');
  }
  const existing = getOwnedEntry(ctx, userId, side, id);
  const newRecordedAt = patch.recordedOn
    ? `${patch.recordedOn}T12:00:00.000Z`
    : existing.recorded_at;
  ctx.db
    .prepare(`UPDATE ${SIDES[side].table} SET value_minor = ?, recorded_at = ? WHERE id = ?`)
    .run(patch.valueMinor ?? existing.value_minor, newRecordedAt, id);

  // History changed from the earliest affected date onward.
  const from = [existing.recorded_at, newRecordedAt].sort()[0]!.slice(0, 10);
  recomputeSnapshotRange(ctx.db, userId, from, today);
  return toEntryDto(side, getOwnedEntry(ctx, userId, side, id));
}

export function deleteHistoryEntry(
  ctx: AppContext,
  userId: number,
  side: EntrySide,
  id: number,
): void {
  const existing = getOwnedEntry(ctx, userId, side, id);
  const s = SIDES[side];
  const count = ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM ${s.table} WHERE ${s.fk} = ?`)
    .get(existing.holding_id) as { n: number };
  if (count.n <= 1) {
    throw badRequest(`This is the only entry for ${existing.holding_name} — delete the holding instead`);
  }
  ctx.db.prepare(`DELETE FROM ${s.table} WHERE id = ?`).run(id);
  recomputeSnapshotRange(ctx.db, userId, existing.recorded_at.slice(0, 10), todayISO(ctx.now));
}

export function deleteLegacyWealth(ctx: AppContext, userId: number, date: string): boolean {
  const result = ctx.db
    .prepare("DELETE FROM snapshots WHERE user_id = ? AND snapshot_date = ? AND source = 'legacy'")
    .run(userId, date);
  if (result.changes === 0) return false;
  // If real valuations cover this date, restore the computed snapshot.
  const hasData = ctx.db
    .prepare(
      `SELECT 1 FROM asset_valuations v JOIN assets a ON a.id = v.asset_id
       WHERE a.user_id = ? AND v.recorded_at <= ?
       UNION
       SELECT 1 FROM liability_valuations v JOIN liabilities l ON l.id = v.liability_id
       WHERE l.user_id = ? AND v.recorded_at <= ?
       LIMIT 1`,
    )
    .get(userId, `${date}T23:59:59.999Z`, userId, `${date}T23:59:59.999Z`);
  if (hasData) upsertSnapshot(ctx.db, userId, date);
  return true;
}
