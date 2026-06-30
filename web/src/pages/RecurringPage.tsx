import { useState, type FormEvent } from 'react';
import type { RecurringDto } from '@api';
import {
  useCreateRecurring, useDeleteRecurring, useHoldings, useMe, useRecurring, useUpdateRecurring,
} from '../api/queries.js';
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Select, Spinner } from '../components/ui.js';
import { formatMinor, minorToInput, parseToMinor } from '../lib/money.js';

const CADENCE_LABELS: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
};

export function RecurringPage() {
  const { data: me } = useMe();
  const recurring = useRecurring();
  const update = useUpdateRecurring();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringDto | null>(null);
  const currency = me?.currency ?? 'USD';

  if (recurring.isLoading) return <Spinner label="Loading recurring transactions" />;
  const items = recurring.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Recurring</h1>
        <Button onClick={() => setAdding(true)}>Add schedule</Button>
      </header>
      <p className="text-sm text-ink-400">
        Automatic value changes applied on schedule — salary into savings, loan payments, subscriptions.
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="No recurring movements"
          hint="Schedule a monthly mortgage payment or savings deposit and Concise applies it automatically."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-ink-800">
            {items.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3.5">
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className={`block truncate text-sm ${r.active ? 'text-ink-100' : 'text-ink-600 line-through'}`}>
                    {r.name}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {CADENCE_LABELS[r.cadence]} · {r.targetName} · next {r.nextRunOn}
                    {r.endDate ? ` · ends ${r.endDate}` : ''}
                  </span>
                </button>
                <span className={`tabular shrink-0 text-sm font-semibold ${signedAmount(r) >= 0 ? 'text-gain-400' : 'text-loss-400'}`}>
                  {r.amountType === 'percent'
                    ? `${r.percent! >= 0 ? '+' : ''}${r.percent}%`
                    : `${r.amountMinor! >= 0 ? '+' : ''}${formatMinor(r.amountMinor!, currency)}`}
                </span>
                <label className="flex shrink-0 cursor-pointer items-center" aria-label={`${r.name} active`}>
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={(e) => update.mutate({ id: r.id, active: e.target.checked })}
                    className="peer sr-only"
                  />
                  <span className="relative h-6 w-10 rounded-full bg-ink-700 transition-colors peer-checked:bg-gold-600 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-ink-300 after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-ink-950" />
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && <RecurringForm onClose={() => setAdding(false)} />}
      {editing && <RecurringForm existing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The schedule's signed movement, whatever its type — for colouring. */
function signedAmount(r: RecurringDto): number {
  return r.amountType === 'percent' ? r.percent! : r.amountMinor!;
}

function RecurringForm({ existing, onClose }: { existing?: RecurringDto; onClose: () => void }) {
  const assets = useHoldings('assets');
  const liabilities = useHoldings('liabilities');
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const remove = useDeleteRecurring();

  const [name, setName] = useState(existing?.name ?? '');
  const [targetType, setTargetType] = useState<'asset' | 'liability'>(existing?.targetType ?? 'asset');
  const [targetId, setTargetId] = useState<string>(existing?.targetId.toString() ?? '');
  const [amountType, setAmountType] = useState<'fixed' | 'percent'>(existing?.amountType ?? 'fixed');
  const [direction, setDirection] = useState<'add' | 'subtract'>(
    existing && signedAmount(existing) < 0 ? 'subtract' : 'add',
  );
  const [amount, setAmount] = useState(
    existing
      ? existing.amountType === 'percent'
        ? Math.abs(existing.percent!).toString()
        : minorToInput(Math.abs(existing.amountMinor!))
      : '',
  );
  const [cadence, setCadence] = useState(existing?.cadence ?? 'monthly');
  const [nextRunOn, setNextRunOn] = useState(existing?.nextRunOn ?? defaultNextRun());
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const busy = create.isPending || update.isPending || remove.isPending;
  const targets = (targetType === 'asset' ? assets.data : liabilities.data) ?? [];
  const isMarketTarget = targets.find((t) => String(t.id) === targetId)?.valuationMode === 'market';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    let movement: { amountMinor: number } | { percent: number };
    if (amountType === 'percent') {
      const pct = Number(amount);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) {
        setFormError('Enter a valid percentage, e.g. 0.5');
        return;
      }
      movement = { percent: direction === 'subtract' ? -pct : pct };
    } else {
      const magnitude = parseToMinor(amount);
      if (magnitude === null || magnitude === 0) {
        setFormError('Enter a valid non-zero amount.');
        return;
      }
      movement = { amountMinor: direction === 'subtract' ? -magnitude : magnitude };
    }
    if (endDate && endDate < nextRunOn) {
      setFormError('End date cannot be before the next run date.');
      return;
    }
    const onError = (err: unknown) =>
      setFormError(err instanceof Error ? err.message : 'Something went wrong');

    if (existing) {
      update.mutate(
        { id: existing.id, name, ...movement, cadence, nextRunOn, endDate: endDate || null },
        { onSuccess: onClose, onError },
      );
    } else {
      if (!targetId) {
        setFormError('Choose what this schedule applies to.');
        return;
      }
      create.mutate(
        { name, targetType, targetId: Number(targetId), ...movement, cadence, nextRunOn, endDate: endDate || null },
        { onSuccess: onClose, onError },
      );
    }
  };

  const onDelete = () => {
    if (!existing) return;
    if (!window.confirm(`Delete schedule "${existing.name}"?`)) return;
    remove.mutate(existing.id, { onSuccess: onClose });
  };

  return (
    <Modal title={existing ? `Edit ${existing.name}` : 'Add schedule'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />}
        </Field>

        {!existing && (
          <>
            <Field label="Applies to">
              {(id) => (
                <Select id={id} value={targetType}
                  onChange={(e) => { setTargetType(e.target.value as 'asset' | 'liability'); setTargetId(''); }}>
                  <option value="asset">An asset</option>
                  <option value="liability">A liability</option>
                </Select>
              )}
            </Field>
            <Field label={targetType === 'asset' ? 'Asset' : 'Liability'}>
              {(id) => (
                <Select id={id} value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="" disabled>Choose…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        <Field
          label="Amount type"
          hint={
            isMarketTarget
              ? amountType === 'percent'
                ? 'Grows or shrinks the share count directly each occurrence, regardless of price.'
                : 'Buys or sells that much of the holding at the price on each occurrence date.'
              : amountType === 'percent'
                ? "Applied to the target's value at each occurrence — compounds over time."
                : undefined
          }
        >
          {(id) => (
            <Select id={id} value={amountType} onChange={(e) => setAmountType(e.target.value as 'fixed' | 'percent')}>
              <option value="fixed">Fixed amount</option>
              <option value="percent">Percentage of current value</option>
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Direction">
            {(id) => (
              <Select id={id} value={direction} onChange={(e) => setDirection(e.target.value as 'add' | 'subtract')}>
                <option value="add">Increase (+)</option>
                <option value="subtract">Decrease (−)</option>
              </Select>
            )}
          </Field>
          <Field label={amountType === 'percent' ? 'Percent (%)' : 'Amount'}>
            {(id) => (
              <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal" placeholder={amountType === 'percent' ? '0.5' : '0.00'} required />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cadence">
            {(id) => (
              <Select id={id} value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
                {Object.entries(CADENCE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Next run">
            {(id) => (
              <Input id={id} type="date" value={nextRunOn} onChange={(e) => setNextRunOn(e.target.value)} required />
            )}
          </Field>
        </div>

        <Field label="End date" hint="Optional — stops the schedule for good once it's passed, e.g. a promo rate.">
          {(id) => (
            <Input id={id} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          )}
        </Field>

        {formError ? <ErrorNote message={formError} /> : null}

        <div className="flex gap-2 pt-1">
          {existing && <Button variant="danger" onClick={onDelete} disabled={busy}>Delete</Button>}
          <Button type="submit" className="flex-1" disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function defaultNextRun(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
