import type { AppContext } from '../../context.js';
import type { GoalDto, GoalType } from '../../types/api.js';
import { addDays, daysBetween, todayISO } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/http.js';
import { assertHoldingOwned } from '../holdings/service.js';
import { LIABILITY_KIND } from '../holdings/kind.js';
import { totalsAsOf } from '../snapshots/service.js';

interface GoalRow {
  id: number;
  name: string;
  goal_type: GoalType;
  target_minor: number;
  liability_id: number | null;
  baseline_minor: number | null;
  target_date: string | null;
  notes: string | null;
  created_at: string;
}

interface Snap {
  snapshot_date: string;
  net_worth_minor: number;
}

/**
 * Rough linear-trend ETA for reaching `targetMinor`, given the current net
 * worth. Deliberately cheap and approximate — like the FX/inflation tables,
 * not the full prediction engine. The baseline is the snapshot at/before one
 * year ago, falling back to the user's earliest snapshot when less history
 * exists. `null` means "not on track" (flat or shrinking net worth while
 * still below target).
 */
function projectedEtaISO(ctx: AppContext, userId: number, targetMinor: number, currentMinor: number): string | null {
  if (currentMinor >= targetMinor) return todayISO(ctx.now);

  const today = todayISO(ctx.now);
  const yearAgo = addDays(today, -365);
  const baseline = (ctx.db
    .prepare(
      `SELECT snapshot_date, net_worth_minor FROM snapshots
       WHERE user_id = ? AND snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`,
    )
    .get(userId, yearAgo) ?? ctx.db
    .prepare(
      `SELECT snapshot_date, net_worth_minor FROM snapshots
       WHERE user_id = ? ORDER BY snapshot_date LIMIT 1`,
    )
    .get(userId)) as Snap | undefined;
  if (!baseline) return null;

  const days = daysBetween(baseline.snapshot_date, today);
  if (days <= 0) return null;
  const dailyRate = (currentMinor - baseline.net_worth_minor) / days;
  if (dailyRate <= 0) return null;

  const daysNeeded = (targetMinor - currentMinor) / dailyRate;
  return addDays(today, Math.ceil(daysNeeded));
}

/**
 * Rough linear-trend ETA for paying a liability down to zero, mirroring
 * {@link projectedEtaISO}'s shape but sourced from that liability's own
 * valuations and with inverted direction: `null` means "not on track" (the
 * balance is flat or growing instead of shrinking).
 */
function projectedPayoffEtaISO(ctx: AppContext, liabilityId: number, currentMinor: number): string | null {
  if (currentMinor <= 0) return todayISO(ctx.now);

  const today = todayISO(ctx.now);
  const yearAgo = addDays(today, -365);
  const baseline = (ctx.db
    .prepare(
      `SELECT recorded_at, value_minor FROM liability_valuations
       WHERE liability_id = ? AND recorded_at <= ? ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    )
    .get(liabilityId, `${yearAgo}T23:59:59.999Z`) ?? ctx.db
    .prepare(
      `SELECT recorded_at, value_minor FROM liability_valuations
       WHERE liability_id = ? ORDER BY recorded_at, id LIMIT 1`,
    )
    .get(liabilityId)) as { recorded_at: string; value_minor: number } | undefined;
  if (!baseline) return null;

  const baselineDate = baseline.recorded_at.slice(0, 10);
  const days = daysBetween(baselineDate, today);
  if (days <= 0) return null;
  const dailyRate = (currentMinor - baseline.value_minor) / days; // negative = paying down
  if (dailyRate >= 0) return null; // flat or growing — not on track

  const daysNeeded = currentMinor / -dailyRate;
  return addDays(today, Math.ceil(daysNeeded));
}

const DAYS_PER_MONTH = 365.25 / 12; // same 365.25-day-year convention already used in
                                     // market/models.ts and dashboard/prediction.ts

/**
 * Rough "save/pay this much per month to hit targetDate" suggestion — null
 * when there's no target date, it isn't in the future, or `remainingMinor`
 * is already <= 0 (goal met). Same rough/non-advice posture as the ETA
 * functions above; `remainingMinor` is computed per goal type by the caller
 * since `target_minor` is always 0 for a payoff goal.
 */
function suggestedMonthlyMinor(ctx: AppContext, targetDate: string | null, remainingMinor: number): number | null {
  if (!targetDate || remainingMinor <= 0) return null;
  const days = daysBetween(todayISO(ctx.now), targetDate);
  if (days <= 0) return null;
  return Math.ceil(remainingMinor / (days / DAYS_PER_MONTH));
}

/** A liability's current balance (latest valuation) and name, for a payoff
 *  goal's progress display. Null if the liability no longer exists. */
function liabilityBalanceAndName(ctx: AppContext, liabilityId: number): { balanceMinor: number; name: string } | null {
  const row = ctx.db
    .prepare(
      `SELECT l.name AS name, COALESCE(v.value_minor, 0) AS balance FROM liabilities l
       LEFT JOIN liability_valuations v ON v.id = (
         SELECT v2.id FROM liability_valuations v2 WHERE v2.liability_id = l.id
         ORDER BY v2.recorded_at DESC, v2.id DESC LIMIT 1
       )
       WHERE l.id = ?`,
    )
    .get(liabilityId) as { name: string; balance: number } | undefined;
  return row ? { balanceMinor: row.balance, name: row.name } : null;
}

function toDto(
  row: GoalRow, currentMinor: number, etaISO: string | null, liabilityName: string | null,
  suggestedMonthlyMinorValue: number | null,
): GoalDto {
  const progressPct = row.goal_type === 'liability_payoff'
    ? (row.baseline_minor! > 0
        ? Math.round(((row.baseline_minor! - currentMinor) / row.baseline_minor!) * 100 * 100) / 100
        : 100)
    : (row.target_minor > 0 ? Math.round((currentMinor / row.target_minor) * 100 * 100) / 100 : 0);
  return {
    id: row.id,
    name: row.name,
    goalType: row.goal_type,
    targetMinor: row.target_minor,
    liabilityId: row.liability_id,
    liabilityName,
    baselineMinor: row.baseline_minor,
    targetDate: row.target_date,
    notes: row.notes,
    currentMinor,
    progressPct,
    etaISO,
    suggestedMonthlyMinor: suggestedMonthlyMinorValue,
    createdAt: row.created_at,
  };
}

/** Current net worth, computed once and shared across every net-worth goal
 *  in a list — payoff goals each query their own liability separately. */
function currentNetWorth(ctx: AppContext, userId: number): number {
  const { assetsMinor, liabilitiesMinor } = totalsAsOf(ctx.db, userId, todayISO(ctx.now));
  return assetsMinor - liabilitiesMinor;
}

function toDtoForRow(ctx: AppContext, userId: number, row: GoalRow, netWorth: number): GoalDto {
  if (row.goal_type === 'liability_payoff') {
    const liability = liabilityBalanceAndName(ctx, row.liability_id!);
    const current = liability?.balanceMinor ?? 0;
    const eta = projectedPayoffEtaISO(ctx, row.liability_id!, current);
    const suggestion = suggestedMonthlyMinor(ctx, row.target_date, current);
    return toDto(row, current, eta, liability?.name ?? null, suggestion);
  }
  const remaining = row.target_minor - netWorth;
  const suggestion = suggestedMonthlyMinor(ctx, row.target_date, remaining);
  return toDto(row, netWorth, projectedEtaISO(ctx, userId, row.target_minor, netWorth), null, suggestion);
}

export function listGoals(ctx: AppContext, userId: number): GoalDto[] {
  const rows = ctx.db
    .prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY created_at, id')
    .all(userId) as unknown as GoalRow[];
  const netWorth = currentNetWorth(ctx, userId);
  return rows.map((row) => toDtoForRow(ctx, userId, row, netWorth));
}

function getRow(ctx: AppContext, userId: number, id: number): GoalRow {
  const row = ctx.db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(id, userId) as
    | GoalRow
    | undefined;
  if (!row) throw notFound('Goal not found');
  return row;
}

export function getGoal(ctx: AppContext, userId: number, id: number): GoalDto {
  const row = getRow(ctx, userId, id);
  return toDtoForRow(ctx, userId, row, currentNetWorth(ctx, userId));
}

export interface GoalInput {
  name: string;
  goalType?: GoalType;
  targetMinor?: number;
  liabilityId?: number;
  targetDate?: string | null;
  notes?: string | null;
}

export function createGoal(ctx: AppContext, userId: number, input: GoalInput): GoalDto {
  const goalType = input.goalType ?? 'net_worth';
  let targetMinor: number;
  let liabilityId: number | null = null;
  let baselineMinor: number | null = null;

  if (goalType === 'liability_payoff') {
    liabilityId = input.liabilityId!;
    assertHoldingOwned(ctx, LIABILITY_KIND, userId, liabilityId);
    const liability = liabilityBalanceAndName(ctx, liabilityId);
    baselineMinor = liability?.balanceMinor ?? 0;
    targetMinor = 0;
  } else {
    targetMinor = input.targetMinor!;
  }

  const id = ctx.db
    .prepare(
      `INSERT INTO goals (user_id, name, goal_type, target_minor, liability_id, baseline_minor, target_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, input.name, goalType, targetMinor, liabilityId, baselineMinor, input.targetDate ?? null, input.notes ?? null)
    .lastInsertRowid as number;
  return getGoal(ctx, userId, id);
}

export interface GoalPatch {
  name?: string;
  targetMinor?: number;
  targetDate?: string | null;
  notes?: string | null;
}

/**
 * A goal's type, target and liability are fixed at creation — only name,
 * target date and notes can be edited. A `targetMinor` patch is accepted in
 * the type for net-worth goals' editing UI and silently ignored for a
 * payoff goal (whose target is always 0).
 */
export function updateGoal(ctx: AppContext, userId: number, id: number, patch: GoalPatch): GoalDto {
  const existing = getRow(ctx, userId, id);
  if (Object.keys(patch).length === 0) throw badRequest('No fields to update');
  const name = patch.name ?? existing.name;
  const targetMinor = existing.goal_type === 'liability_payoff'
    ? existing.target_minor
    : patch.targetMinor ?? existing.target_minor;
  const targetDate = patch.targetDate !== undefined ? patch.targetDate : existing.target_date;
  const notes = patch.notes !== undefined ? patch.notes : existing.notes;
  ctx.db
    .prepare('UPDATE goals SET name = ?, target_minor = ?, target_date = ?, notes = ? WHERE id = ?')
    .run(name, targetMinor, targetDate, notes, id);
  return getGoal(ctx, userId, id);
}

export function deleteGoal(ctx: AppContext, userId: number, id: number): void {
  getRow(ctx, userId, id);
  ctx.db.prepare('DELETE FROM goals WHERE id = ?').run(id);
}
