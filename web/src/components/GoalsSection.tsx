import { useState, type FormEvent } from 'react';
import type { GoalDto, GoalType } from '@api';
import {
  useCreateGoal, useCreateRecurring, useDeleteGoal, useGoals, useHoldings, useMe, useUpdateGoal,
} from '../api/queries.js';
import { Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner, SuccessNote } from './ui.js';
import { DatePicker } from './DatePicker.js';
import { formatMinor, minorToInput, parseToMinor } from '../lib/money.js';

/** Secondary line under a goal's name: progress framed against the target
 *  (net worth) or what remains of the original balance (payoff). */
function progressLine(goal: GoalDto, currency: string): string {
  const eta = goal.etaISO ? ` · on track for ${goal.etaISO}` : ' · not on track';
  if (goal.goalType === 'liability_payoff') {
    return `${formatMinor(goal.currentMinor, currency)} remaining of ${formatMinor(goal.baselineMinor!, currency)}${eta}`;
  }
  return `${formatMinor(goal.currentMinor, currency)} of ${formatMinor(goal.targetMinor, currency)}${eta}`;
}

/** Rough "save/pay this much per month" line, shown when a target date makes
 *  one computable — omitted entirely (returns null) otherwise. */
function fundingLine(goal: GoalDto, currency: string): string | null {
  if (goal.suggestedMonthlyMinor == null) return null;
  const amount = formatMinor(goal.suggestedMonthlyMinor, currency);
  return goal.goalType === 'liability_payoff'
    ? `Pay an extra ${amount}/mo to clear this by ${goal.targetDate}`
    : `Save ${amount}/mo to reach this by ${goal.targetDate}`;
}

/** Tomorrow, as a YYYY-MM-DD string — matches RecurringPage.tsx's own
 *  default for a brand-new schedule's first run date. */
function defaultNextRun(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Settings card: full CRUD over net-worth and liability-payoff goals (the
 *  read-only progress view lives on the dashboard — see GoalsCard). */
export function GoalsSection() {
  const { data: me } = useMe();
  const goals = useGoals();
  const deleteGoal = useDeleteGoal();
  const [editing, setEditing] = useState<GoalDto | 'new' | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const currency = me?.currency ?? 'USD';

  const onDelete = (goal: GoalDto) => {
    if (!window.confirm(`Delete the goal "${goal.name}"?`)) return;
    setDeleteError(null);
    deleteGoal.mutate(goal.id, {
      onError: (err) => setDeleteError(err instanceof Error ? err.message : 'Delete failed'),
    });
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-widest text-ink-400">Goals</h2>
        <Button variant="ghost" onClick={() => setEditing('new')}>Add goal</Button>
      </div>

      {deleteError ? <div className="mb-3"><ErrorNote message={deleteError} /></div> : null}

      {goals.isLoading ? (
        <Spinner label="Loading goals" />
      ) : (goals.data ?? []).length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">
          No goals yet — set a target net worth, or pick a liability to pay off, to track your progress.
        </p>
      ) : (
        <ul className="space-y-3">
          {goals.data!.map((goal) => (
            <li key={goal.id} className="rounded-xl border border-ink-800 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(goal)}
                  className="min-w-0 flex-1 text-left hover:text-gold-400"
                >
                  <span className="block truncate text-sm font-medium text-ink-100">{goal.name}</span>
                  <span className="block break-words text-xs text-ink-400">{progressLine(goal, currency)}</span>
                </button>
                <Button
                  variant="subtle"
                  aria-label={`Delete ${goal.name}`}
                  onClick={() => onDelete(goal)}
                  disabled={deleteGoal.isPending}
                >
                  Remove
                </Button>
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-gold-500"
                  style={{ width: `${Math.min(100, Math.max(0, goal.progressPct))}%` }}
                />
              </div>
              {fundingLine(goal, currency) && (
                <p className="mt-2 break-words text-xs text-ink-400">{fundingLine(goal, currency)}</p>
              )}
              {goal.goalType === 'liability_payoff' && goal.suggestedMonthlyMinor != null && (
                <AutomatePayoffButton goal={goal} />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <GoalEditModal goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/**
 * One-click automation for a payoff goal's suggested extra payment — calls
 * useCreateRecurring() directly (no form/modal, everything needed is already
 * known: the goal's liability, the suggested amount). On success the button
 * is replaced by a SuccessNote so a second click is structurally impossible;
 * on error it stays clickable (retry) with an ErrorNote alongside.
 */
function AutomatePayoffButton({ goal }: { goal: GoalDto }) {
  const createRecurring = useCreateRecurring();
  const [status, setStatus] = useState<'idle' | 'success' | string>('idle');

  if (status === 'success') {
    return <div className="mt-2"><SuccessNote message="Automatic payment scheduled — see Recurring." /></div>;
  }

  const onClick = () => {
    setStatus('idle');
    createRecurring.mutate(
      {
        name: `Pay off ${goal.liabilityName}`,
        targetType: 'liability',
        targetId: goal.liabilityId!,
        amountMinor: -goal.suggestedMonthlyMinor!,
        cadence: 'monthly',
        nextRunOn: defaultNextRun(),
      },
      {
        onSuccess: () => setStatus('success'),
        onError: (err) => setStatus(err instanceof Error ? err.message : 'Could not schedule automatic payment'),
      },
    );
  };

  return (
    <div className="mt-2 space-y-1.5">
      <Button variant="ghost" onClick={onClick} disabled={createRecurring.isPending}>
        {createRecurring.isPending ? 'Automating…' : 'Automate this payment'}
      </Button>
      {status !== 'idle' && <ErrorNote message={status} />}
    </div>
  );
}

function GoalEditModal({ goal, onClose }: { goal: GoalDto | null; onClose: () => void }) {
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const liabilities = useHoldings('liabilities');
  const [name, setName] = useState(goal?.name ?? '');
  const [goalType, setGoalType] = useState<GoalType>(goal?.goalType ?? 'net_worth');
  const [target, setTarget] = useState(goal && goal.goalType === 'net_worth' ? minorToInput(goal.targetMinor) : '');
  const [liabilityId, setLiabilityId] = useState(goal?.liabilityId ? String(goal.liabilityId) : '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [notes, setNotes] = useState(goal?.notes ?? '');
  const [showOnPrediction, setShowOnPrediction] = useState(goal?.showOnPrediction ?? true);
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const isPayoff = goalType === 'liability_payoff';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Enter a name for this goal.');
      return;
    }
    const onError = (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save');
    if (goal) {
      // Type, target and liability are fixed at creation — only these fields are editable.
      update.mutate(
        { id: goal.id, name: name.trim(), targetDate: targetDate || null, notes: notes.trim() || null, showOnPrediction },
        { onSuccess: onClose, onError },
      );
      return;
    }
    if (isPayoff) {
      if (!liabilityId) {
        setError('Choose a liability to pay off.');
        return;
      }
      create.mutate(
        {
          name: name.trim(), goalType: 'liability_payoff', liabilityId: Number(liabilityId),
          targetDate: targetDate || null, notes: notes.trim() || null, showOnPrediction,
        },
        { onSuccess: onClose, onError },
      );
      return;
    }
    const targetMinor = parseToMinor(target);
    if (targetMinor === null || targetMinor <= 0) {
      setError('Enter a target amount greater than zero.');
      return;
    }
    create.mutate(
      {
        name: name.trim(), goalType: 'net_worth', targetMinor,
        targetDate: targetDate || null, notes: notes.trim() || null, showOnPrediction,
      },
      { onSuccess: onClose, onError },
    );
  };

  return (
    <Modal title={goal ? 'Edit goal' : 'Add goal'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />}
        </Field>
        {!goal && (
          <Field label="Goal type">
            {(id) => (
              <Select id={id} value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType)}>
                <option value="net_worth">Reach a net worth</option>
                <option value="liability_payoff">Pay off a liability</option>
              </Select>
            )}
          </Field>
        )}
        {goal ? (
          goal.goalType === 'liability_payoff' ? (
            <p className="text-xs text-ink-400">
              Paying off {goal.liabilityName} — target and liability can't be changed after creation.
            </p>
          ) : (
            <p className="text-xs text-ink-400">Target net worth: {minorToInput(goal.targetMinor)} (fixed)</p>
          )
        ) : isPayoff ? (
          <Field label="Liability" hint="The target is implicit — paid off means a balance of zero.">
            {(id) => (
              <Select id={id} value={liabilityId} onChange={(e) => setLiabilityId(e.target.value)} required>
                <option value="">Choose a liability…</option>
                {(liabilities.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Target net worth">
            {(id) => (
              <Input id={id} value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" required />
            )}
          </Field>
        )}
        <Field label="Target date" hint="Optional — a deadline you're aiming for, separate from the projected ETA.">
          {(id) => <DatePicker id={id} value={targetDate ?? ''} onChange={setTargetDate} />}
        </Field>
        <Field label="Notes" hint="Optional.">
          {(id) => <Input id={id} value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />}
        </Field>
        <label className="flex items-start gap-3 rounded-xl border border-ink-800 p-3.5">
          <input
            type="checkbox"
            checked={showOnPrediction}
            onChange={(e) => setShowOnPrediction(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-gold-500"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-100">Show on prediction graph</span>
            <span className="block text-xs text-ink-400">
              Draws a gold line at this goal’s projected date when the dashboard is in prediction mode.
            </span>
          </span>
        </label>
        {error ? <ErrorNote message={error} /> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Saving…' : 'Save goal'}
        </Button>
      </form>
    </Modal>
  );
}
