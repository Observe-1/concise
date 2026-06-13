import type { AppContext } from '../../context.js';
import type { Cadence, RecurringDto } from '../../types/api.js';
import { withTransaction } from '../../db/connection.js';
import { advanceCadence, todayISO } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/http.js';
import { recomputeSnapshotRange } from '../snapshots/service.js';

interface RecurringRow {
  id: number;
  user_id: number;
  name: string;
  asset_id: number | null;
  liability_id: number | null;
  amount_type: 'fixed' | 'percent';
  amount_minor: number | null;
  percent: number | null;
  cadence: Cadence;
  next_run_on: string;
  last_run_on: string | null;
  active: number;
  target_name: string | null;
}

const SELECT = `
  SELECT r.*, COALESCE(a.name, l.name) AS target_name
  FROM recurring_transactions r
  LEFT JOIN assets a ON a.id = r.asset_id
  LEFT JOIN liabilities l ON l.id = r.liability_id`;

function toDto(row: RecurringRow): RecurringDto {
  return {
    id: row.id,
    name: row.name,
    targetType: row.asset_id !== null ? 'asset' : 'liability',
    targetId: (row.asset_id ?? row.liability_id)!,
    targetName: row.target_name ?? '(deleted)',
    amountType: row.amount_type,
    amountMinor: row.amount_minor,
    percent: row.percent,
    cadence: row.cadence,
    nextRunOn: row.next_run_on,
    lastRunOn: row.last_run_on,
    active: row.active === 1,
  };
}

export function listRecurring(ctx: AppContext, userId: number): RecurringDto[] {
  const rows = ctx.db
    .prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.created_at, r.id`)
    .all(userId) as unknown as RecurringRow[];
  return rows.map(toDto);
}

export interface CreateRecurringInput {
  name: string;
  targetType: 'asset' | 'liability';
  targetId: number;
  /** Exactly one of amountMinor (fixed) / percent must be provided. */
  amountMinor?: number;
  percent?: number;
  cadence: Cadence;
  nextRunOn: string;
}

function assertTargetOwned(ctx: AppContext, userId: number, type: 'asset' | 'liability', id: number): void {
  const table = type === 'asset' ? 'assets' : 'liabilities';
  const row = ctx.db.prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) throw badRequest(`Target ${type} not found`);
}

export function createRecurring(ctx: AppContext, userId: number, input: CreateRecurringInput): RecurringDto {
  assertTargetOwned(ctx, userId, input.targetType, input.targetId);
  const isPercent = input.percent !== undefined;
  const id = ctx.db
    .prepare(
      `INSERT INTO recurring_transactions
         (user_id, name, asset_id, liability_id, amount_type, amount_minor, percent, cadence, next_run_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId, input.name,
      input.targetType === 'asset' ? input.targetId : null,
      input.targetType === 'liability' ? input.targetId : null,
      isPercent ? 'percent' : 'fixed',
      isPercent ? null : input.amountMinor!,
      isPercent ? input.percent! : null,
      input.cadence, input.nextRunOn,
    ).lastInsertRowid as number;
  return getRecurring(ctx, userId, id);
}

export function getRecurring(ctx: AppContext, userId: number, id: number): RecurringDto {
  const row = ctx.db
    .prepare(`${SELECT} WHERE r.user_id = ? AND r.id = ?`)
    .get(userId, id) as unknown as RecurringRow | undefined;
  if (!row) throw notFound('Recurring transaction not found');
  return toDto(row);
}

export interface UpdateRecurringInput {
  name?: string;
  amountMinor?: number;
  percent?: number;
  cadence?: Cadence;
  nextRunOn?: string;
  active?: boolean;
}

export function updateRecurring(
  ctx: AppContext,
  userId: number,
  id: number,
  patch: UpdateRecurringInput,
): RecurringDto {
  const existing = getRecurring(ctx, userId, id);
  // Supplying percent switches the schedule to percent mode and vice versa;
  // otherwise the existing amount settings stand.
  let amountType = existing.amountType;
  let amountMinor = existing.amountMinor;
  let percent = existing.percent;
  if (patch.percent !== undefined) {
    amountType = 'percent';
    percent = patch.percent;
    amountMinor = null;
  } else if (patch.amountMinor !== undefined) {
    amountType = 'fixed';
    amountMinor = patch.amountMinor;
    percent = null;
  }
  ctx.db
    .prepare(
      `UPDATE recurring_transactions
       SET name = ?, amount_type = ?, amount_minor = ?, percent = ?, cadence = ?, next_run_on = ?, active = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      amountType,
      amountMinor,
      percent,
      patch.cadence ?? existing.cadence,
      patch.nextRunOn ?? existing.nextRunOn,
      (patch.active ?? existing.active) ? 1 : 0,
      id,
    );
  return getRecurring(ctx, userId, id);
}

export function deleteRecurring(ctx: AppContext, userId: number, id: number): void {
  getRecurring(ctx, userId, id); // 404 if not owned
  ctx.db.prepare('DELETE FROM recurring_transactions WHERE id = ?').run(id);
}

/**
 * The recurring engine. Processes every active schedule whose cursor is due
 * (next_run_on <= today), appending a 'recurring' valuation per occurrence:
 *   fixed:   new value = latest value + amount          (floored at 0)
 *   percent: new value = latest value × (1 + pct/100)   (floored at 0)
 * The cursor advances per cadence until it points past today, so missed runs
 * catch up after downtime. Affected users get their snapshots recomputed from
 * the earliest applied date. Idempotent: a processed occurrence moves the
 * cursor forward inside the same transaction.
 *
 * Paid off: when an occurrence drives a liability's balance to zero or below,
 * the balance is set to 0 and every recurring schedule against that liability
 * is suspended (active = 0) — no further payments or interest are applied
 * until the user reactivates it. (Assets just floor at 0; they keep running.)
 *
 * Returns the number of occurrences applied.
 */
export function runDueRecurring(ctx: AppContext, userId?: number): number {
  const today = todayISO(ctx.now);
  let applied = 0;
  const dueRows = ctx.db
    .prepare(
      `SELECT * FROM recurring_transactions
       WHERE active = 1 AND next_run_on <= ?${userId ? ' AND user_id = ?' : ''}`,
    )
    .all(...(userId ? [today, userId] : [today])) as unknown as RecurringRow[];

  // earliest applied date per user, for snapshot recompute
  const earliestByUser = new Map<number, string>();
  // liabilities paid off during this run — their other schedules are suspended
  const paidOffLiabilities = new Set<number>();
  const suspendForLiability = ctx.db.prepare(
    'UPDATE recurring_transactions SET active = 0 WHERE liability_id = ?',
  );

  withTransaction(ctx.db, () => {
    for (const row of dueRows) {
      const isAsset = row.asset_id !== null;
      const targetId = (row.asset_id ?? row.liability_id)!;
      // A payoff earlier in this run already suspended this liability's
      // schedules — don't apply any more occurrences against it.
      if (!isAsset && paidOffLiabilities.has(targetId)) continue;

      const valuationTable = isAsset ? 'asset_valuations' : 'liability_valuations';
      const fk = isAsset ? 'asset_id' : 'liability_id';

      const latestStmt = ctx.db.prepare(
        `SELECT value_minor, recorded_at FROM ${valuationTable} WHERE ${fk} = ?
         ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      );
      const insertStmt = ctx.db.prepare(
        `INSERT INTO ${valuationTable} (${fk}, value_minor, source, recorded_at)
         VALUES (?, ?, 'recurring', ?)`,
      );

      let cursor = row.next_run_on;
      let lastRun = row.last_run_on;
      let paidOff = false;
      while (cursor <= today) {
        const latest = latestStmt.get(targetId) as
          | { value_minor: number; recorded_at: string }
          | undefined;
        const current = latest?.value_minor ?? 0;
        const rawValue = row.amount_type === 'percent'
          ? Math.round(current * (1 + row.percent! / 100))
          : current + row.amount_minor!;
        const newValue = Math.max(0, rawValue);
        // Record on the scheduled day, but never before the latest existing
        // valuation — the occurrence supersedes it as the current value.
        let recordedAt = `${cursor}T00:00:00.000Z`;
        if (latest && latest.recorded_at >= recordedAt) {
          recordedAt = new Date(Date.parse(latest.recorded_at) + 1).toISOString();
        }
        insertStmt.run(targetId, newValue, recordedAt);
        applied++;
        const prevEarliest = earliestByUser.get(row.user_id);
        if (!prevEarliest || cursor < prevEarliest) earliestByUser.set(row.user_id, cursor);
        lastRun = cursor;
        cursor = advanceCadence(cursor, row.cadence);
        // A liability hitting zero is paid off: stop here and suspend it.
        if (!isAsset && rawValue <= 0) {
          paidOff = true;
          paidOffLiabilities.add(targetId);
          break;
        }
      }
      ctx.db
        .prepare('UPDATE recurring_transactions SET next_run_on = ?, last_run_on = ? WHERE id = ?')
        .run(cursor, lastRun, row.id);
      // Paid off: suspend every schedule against the liability (this row and
      // any siblings). Done after the cursor update so this row's cursor still
      // reflects the work applied.
      if (paidOff) suspendForLiability.run(targetId);
    }
    for (const [uid, from] of earliestByUser) {
      recomputeSnapshotRange(ctx.db, uid, from, today);
    }
  });
  return applied;
}
