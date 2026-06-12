import type { AppContext } from '../../context.js';
import type { LegacySnapshotDto } from '../../types/api.js';
import { badRequest } from '../../lib/http.js';
import { todayISO } from '../../lib/dates.js';
import { upsertSnapshot } from '../snapshots/service.js';

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
