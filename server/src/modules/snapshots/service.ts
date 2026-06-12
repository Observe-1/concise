import type { DatabaseSync } from 'node:sqlite';
import type { AppContext } from '../../context.js';
import { addDays, toDateISO, todayISO } from '../../lib/dates.js';

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

/**
 * Recompute snapshots for every day in [fromISO, toISO]. Bulk implementation:
 * loads each holding's valuations once and walks the days with per-holding
 * cursors (O(days × holdings)), so multi-year backdates stay fast. Legacy
 * rows are preserved by the upsert guard.
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
    `SELECT v.asset_id AS hid, v.value_minor, v.recorded_at
     FROM asset_valuations v JOIN assets a ON a.id = v.asset_id
     WHERE a.user_id = ? AND v.recorded_at <= ?
     ORDER BY v.recorded_at, v.id`,
  ).all(userId, cutoff) as unknown as ValuationRow[]);
  const liabilitySeries = groupByHolding(db.prepare(
    `SELECT v.liability_id AS hid, v.value_minor, v.recorded_at
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

  const allSeries = [...assetSeries, ...liabilitySeries];
  const cursors = allSeries.map(() => 0);
  const currents = allSeries.map(() => 0);
  const assetCount = assetSeries.length;
  for (let d = fromISO; d <= toISO; d = addDays(d, 1)) {
    const dayEnd = `${d}T23:59:59.999Z`;
    let assets = 0;
    let liabilities = 0;
    allSeries.forEach((series, i) => {
      while (cursors[i]! < series.length && series[cursors[i]!]!.recorded_at <= dayEnd) {
        currents[i] = series[cursors[i]!]!.value_minor;
        cursors[i]!++;
      }
      if (i < assetCount) assets += currents[i]!;
      else liabilities += currents[i]!;
    });
    upsert.run(userId, d, assets, liabilities, assets - liabilities);
  }
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
