import type { DatabaseSync } from 'node:sqlite';
import type { AppContext } from '../../context.js';
import { addDays, toDateISO, todayISO } from '../../lib/dates.js';
import type { HoldingKind } from '../holdings/kind.js';

export interface Totals {
  assetsMinor: number;
  liabilitiesMinor: number;
}

/**
 * Portfolio totals as of the end of `dateISO`: for every entry, the latest
 * valuation recorded on or before that day (entries with no valuation yet
 * contribute zero).
 */
export function totalsAsOf(db: DatabaseSync, userId: number, dateISO: string): Totals {
  const cutoff = `${dateISO}T23:59:59.999Z`;
  const assetRow = db
    .prepare(
      `SELECT COALESCE(SUM(v.value_minor), 0) AS total
       FROM assets a
       JOIN asset_valuations v ON v.id = (
         SELECT v2.id FROM asset_valuations v2
         WHERE v2.asset_id = a.id AND v2.recorded_at <= ?
         ORDER BY v2.recorded_at DESC, v2.id DESC LIMIT 1
       )
       WHERE a.user_id = ?`,
    )
    .get(cutoff, userId) as { total: number };
  const liabilityRow = db
    .prepare(
      `SELECT COALESCE(SUM(v.value_minor), 0) AS total
       FROM liabilities l
       JOIN liability_valuations v ON v.id = (
         SELECT v2.id FROM liability_valuations v2
         WHERE v2.liability_id = l.id AND v2.recorded_at <= ?
         ORDER BY v2.recorded_at DESC, v2.id DESC LIMIT 1
       )
       WHERE l.user_id = ?`,
    )
    .get(cutoff, userId) as { total: number };
  return { assetsMinor: assetRow.total, liabilitiesMinor: liabilityRow.total };
}

export function upsertSnapshot(db: DatabaseSync, userId: number, dateISO: string): void {
  const { assetsMinor, liabilitiesMinor } = totalsAsOf(db, userId, dateISO);
  // Never clobber user-entered legacy wealth points.
  db.prepare(
    `INSERT INTO snapshots (user_id, snapshot_date, assets_minor, liabilities_minor, net_worth_minor)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
       assets_minor = excluded.assets_minor,
       liabilities_minor = excluded.liabilities_minor,
       net_worth_minor = excluded.net_worth_minor
     WHERE snapshots.source != 'legacy'`,
  ).run(userId, dateISO, assetsMinor, liabilitiesMinor, assetsMinor - liabilitiesMinor);
}

interface ValuationRow {
  hid: number;
  value_minor: number;
  recorded_at: string;
  source: string;
}

function groupByHolding(rows: ValuationRow[]): ValuationRow[][] {
  const map = new Map<number, ValuationRow[]>();
  for (const row of rows) {
    const list = map.get(row.hid);
    if (list) list.push(row);
    else map.set(row.hid, [row]);
  }
  return [...map.values()];
}

const DAY_MS = 86_400_000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);

/** One value per calendar day (the day's last valuation wins). */
interface Anchor {
  day: number;
  value: number;
  manual: boolean;
}

function toAnchors(series: ValuationRow[]): Anchor[] {
  const anchors: Anchor[] = [];
  for (const row of series) {
    const day = dayNum(row.recorded_at);
    const last = anchors[anchors.length - 1];
    if (last && last.day === day) {
      last.value = row.value_minor;
      last.manual = row.source === 'manual';
    } else {
      anchors.push({ day, value: row.value_minor, manual: row.source === 'manual' });
    }
  }
  return anchors;
}

/**
 * A holding's value at the end of day `d`, where `i` indexes the last anchor
 * on or before `d` (-1 when none). A manual revaluation after a gap is
 * interpolated linearly across the gap — the change happened over the whole
 * period, not on the day it was typed in — so graphs ramp instead of showing
 * a one-day cliff. Recurring/market/seed valuations are events that genuinely
 * occur on their day and keep step semantics.
 */
function valueAt(anchors: Anchor[], i: number, d: number): number {
  if (i < 0) return 0;
  const a = anchors[i]!;
  const b = anchors[i + 1];
  if (b && b.manual && d > a.day && b.day - a.day > 1) {
    return Math.round(a.value + ((b.value - a.value) * (d - a.day)) / (b.day - a.day));
  }
  return a.value;
}

/**
 * Recompute snapshots for every day in [fromISO, toISO]. Bulk implementation:
 * loads each holding's valuations once and walks the days with per-holding
 * cursors (O(days × holdings)), so multi-year backdates stay fast. Legacy
 * rows are preserved by the upsert guard. Note: interpolation looks one
 * anchor ahead, so callers that change a valuation must recompute from the
 * holding's previous anchor (see history service), not just the changed day.
 */
export function recomputeSnapshotRange(
  db: DatabaseSync,
  userId: number,
  fromISO: string,
  toISO: string,
): void {
  if (fromISO > toISO) return;
  const cutoff = `${toISO}T23:59:59.999Z`;
  const assetSeries = groupByHolding(db.prepare(
    `SELECT v.asset_id AS hid, v.value_minor, v.recorded_at, v.source
     FROM asset_valuations v JOIN assets a ON a.id = v.asset_id
     WHERE a.user_id = ? AND v.recorded_at <= ?
     ORDER BY v.recorded_at, v.id`,
  ).all(userId, cutoff) as unknown as ValuationRow[]);
  const liabilitySeries = groupByHolding(db.prepare(
    `SELECT v.liability_id AS hid, v.value_minor, v.recorded_at, v.source
     FROM liability_valuations v JOIN liabilities l ON l.id = v.liability_id
     WHERE l.user_id = ? AND v.recorded_at <= ?
     ORDER BY v.recorded_at, v.id`,
  ).all(userId, cutoff) as unknown as ValuationRow[]);

  const upsert = db.prepare(
    `INSERT INTO snapshots (user_id, snapshot_date, assets_minor, liabilities_minor, net_worth_minor)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
       assets_minor = excluded.assets_minor,
       liabilities_minor = excluded.liabilities_minor,
       net_worth_minor = excluded.net_worth_minor
     WHERE snapshots.source != 'legacy'`,
  );

  const allAnchors = [...assetSeries.map(toAnchors), ...liabilitySeries.map(toAnchors)];
  const cursors = allAnchors.map(() => -1);
  const assetCount = assetSeries.length;
  let dNum = dayNum(fromISO);
  for (let d = fromISO; d <= toISO; d = addDays(d, 1), dNum++) {
    let assets = 0;
    let liabilities = 0;
    allAnchors.forEach((anchors, i) => {
      while (cursors[i]! + 1 < anchors.length && anchors[cursors[i]! + 1]!.day <= dNum) {
        cursors[i]!++;
      }
      const value = valueAt(anchors, cursors[i]!, dNum);
      if (i < assetCount) assets += value;
      else liabilities += value;
    });
    upsert.run(userId, d, assets, liabilities, assets - liabilities);
  }
}

/**
 * One value per calendar day in [fromISO, toISO] for a single holding, using
 * the same anchor + gap-interpolation rules as `recomputeSnapshotRange` (a
 * manual revaluation after a gap ramps; recurring/market/seed are step events).
 * Powers the per-holding line graph and its prediction history slice so they
 * smooth exactly like the dashboard graph. Days before the first valuation
 * read as 0.
 */
export function holdingDailySeries(
  db: DatabaseSync,
  k: HoldingKind,
  holdingId: number,
  fromISO: string,
  toISO: string,
): number[] {
  const out: number[] = [];
  if (fromISO > toISO) return out;
  const cutoff = `${toISO}T23:59:59.999Z`;
  const rows = db
    .prepare(
      `SELECT ${holdingId} AS hid, value_minor, recorded_at, source
       FROM ${k.valuationTable} WHERE ${k.fk} = ? AND recorded_at <= ?
       ORDER BY recorded_at, id`,
    )
    .all(holdingId, cutoff) as unknown as ValuationRow[];
  const anchors = toAnchors(rows);
  let cursor = -1;
  let dNum = dayNum(fromISO);
  for (let d = fromISO; d <= toISO; d = addDays(d, 1), dNum++) {
    while (cursor + 1 < anchors.length && anchors[cursor + 1]!.day <= dNum) cursor++;
    out.push(valueAt(anchors, cursor, dNum));
  }
  return out;
}

export function refreshTodaySnapshot(ctx: AppContext, userId: number): void {
  upsertSnapshot(ctx.db, userId, todayISO(ctx.now));
}

/**
 * Fill any snapshot gap between the user's last snapshot and today
 * (self-heals after downtime). Users with no snapshots get one for today.
 */
export function backfillSnapshots(ctx: AppContext, userId: number): void {
  const today = todayISO(ctx.now);
  const row = ctx.db
    .prepare('SELECT MAX(snapshot_date) AS last FROM snapshots WHERE user_id = ?')
    .get(userId) as { last: string | null };
  const from = row.last ? addDays(row.last, 1) : today;
  if (from > today && row.last !== null) {
    // Clock went backwards or already current — still refresh today.
    upsertSnapshot(ctx.db, userId, today);
    return;
  }
  recomputeSnapshotRange(ctx.db, userId, from, today);
}

export function allUserIds(db: DatabaseSync): number[] {
  return (db.prepare('SELECT id FROM users').all() as { id: number }[]).map((r) => r.id);
}

export { toDateISO };
