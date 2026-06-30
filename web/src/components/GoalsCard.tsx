import type { GoalDto } from '@api';
import { Link } from 'react-router-dom';
import { useGoals, useMe } from '../api/queries.js';
import { Card } from './ui.js';
import { formatMinor } from '../lib/money.js';

/** Rough "save/pay this much per month" line — null when no target date
 *  makes one computable. Informational only; the action to automate a
 *  payoff goal's payment lives in Settings → Goals (GoalsSection), not here. */
function fundingLine(goal: GoalDto, currency: string): string | null {
  if (goal.suggestedMonthlyMinor == null) return null;
  const amount = formatMinor(goal.suggestedMonthlyMinor, currency);
  return goal.goalType === 'liability_payoff'
    ? `Pay an extra ${amount}/mo to clear this by ${goal.targetDate}`
    : `Save ${amount}/mo to reach this by ${goal.targetDate}`;
}

/** Read-only progress bars for the dashboard. Hidden entirely when the user
 *  has no goals — manage them from Settings → Goals. */
export function GoalsCard() {
  const { data: me } = useMe();
  const goals = useGoals();
  const currency = me?.currency ?? 'USD';

  if (!goals.data || goals.data.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-widest text-ink-400">Goals</h2>
        <Link to="/settings/goals" className="text-xs text-ink-400 hover:text-gold-400">Manage</Link>
      </div>
      <ul className="space-y-3">
        {goals.data.map((goal) => (
          <li key={goal.id}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink-100">{goal.name}</span>
              <span className="tabular shrink-0 text-xs text-ink-400">
                {goal.goalType === 'liability_payoff'
                  ? `${formatMinor(goal.currentMinor, currency)} left of ${formatMinor(goal.baselineMinor!, currency)}`
                  : `${formatMinor(goal.currentMinor, currency)} / ${formatMinor(goal.targetMinor, currency)}`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-gold-500"
                style={{ width: `${Math.min(100, Math.max(0, goal.progressPct))}%` }}
              />
            </div>
            <span className="mt-1 block break-words text-[11px] text-ink-600">
              {goal.etaISO ? `On track for ${goal.etaISO}` : 'Not on track at the current rate'}
            </span>
            {fundingLine(goal, currency) && (
              <span className="mt-0.5 block break-words text-[11px] text-ink-600">{fundingLine(goal, currency)}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
