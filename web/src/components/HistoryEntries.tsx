import { useState, type FormEvent } from 'react';
import type { HistoryEntryDto } from '@api';
import {
  useDeleteHistoryEntry, useHistoryEntries, useHoldings, useMe, useUpdateHistoryEntry,
} from '../api/queries.js';
import { Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner } from './ui.js';
import { categoryDisplay } from '../lib/categories.js';
import { formatMinor, minorToInput, parseToMinor } from '../lib/money.js';

const SHOW_LIMIT = 100;

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', recurring: 'Recurring', market: 'Market', seed: 'Demo data',
};

/**
 * Settings card: every historic valuation entry across all holdings, with a
 * holding filter, inline editing (value and date) and deletion.
 */
export function HistoryEntries() {
  const { data: me } = useMe();
  const assets = useHoldings('assets');
  const liabilities = useHoldings('liabilities');
  // filter encoded as "asset:12", "liability:3" or ""
  const [filterKey, setFilterKey] = useState('');
  const [side, holdingId] = filterKey
    ? [filterKey.split(':')[0] as 'asset' | 'liability', Number(filterKey.split(':')[1])]
    : [undefined, undefined];
  const entries = useHistoryEntries({ side, holdingId });
  const [editing, setEditing] = useState<HistoryEntryDto | null>(null);
  const deleteEntry = useDeleteHistoryEntry();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const currency = me?.currency ?? 'USD';

  const onDelete = (entry: HistoryEntryDto) => {
    if (!window.confirm(`Delete the ${entry.recordedAt.slice(0, 10)} entry for "${entry.holdingName}"?`)) return;
    setDeleteError(null);
    deleteEntry.mutate(
      { side: entry.side, id: entry.id },
      { onError: (err) => setDeleteError(err instanceof Error ? err.message : 'Delete failed') },
    );
  };

  const shown = (entries.data ?? []).slice(0, SHOW_LIMIT);

  return (
    <Card className="p-5">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-ink-400">Historic entries</h2>
      <p className="mb-4 text-sm text-ink-400">
        Every recorded value across your assets and liabilities. Edit or remove
        entries — your net-worth history is rebuilt automatically.
      </p>

      <Field label="Show">
        {(id) => (
          <Select id={id} value={filterKey} onChange={(e) => setFilterKey(e.target.value)}>
            <option value="">All holdings</option>
            {(assets.data ?? []).map((h) => (
              <option key={`a${h.id}`} value={`asset:${h.id}`}>
                {categoryDisplay('asset', h.category)} — {h.name}
              </option>
            ))}
            {(liabilities.data ?? []).map((h) => (
              <option key={`l${h.id}`} value={`liability:${h.id}`}>
                {categoryDisplay('liability', h.category)} — {h.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {deleteError ? <div className="mt-3"><ErrorNote message={deleteError} /></div> : null}

      {entries.isLoading ? (
        <Spinner label="Loading entries" />
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">No entries yet.</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-ink-800 border-t border-ink-800">
            {shown.map((entry) => (
              <li key={`${entry.side}-${entry.id}`} className="flex items-center gap-3 py-2.5 text-sm">
                <button
                  type="button"
                  onClick={() => setEditing(entry)}
                  className="min-w-0 flex-1 text-left hover:text-gold-400"
                  aria-label={`Edit ${entry.holdingName} entry of ${entry.recordedAt.slice(0, 10)}`}
                >
                  <span className="block truncate text-ink-100">{entry.holdingName}</span>
                  <span className="block text-xs text-ink-400">
                    {entry.recordedAt.slice(0, 10)} · {SOURCE_LABELS[entry.source] ?? entry.source}
                  </span>
                </button>
                <span className={`tabular shrink-0 font-medium ${entry.side === 'asset' ? 'text-gain-400' : 'text-loss-400'}`}>
                  {formatMinor(entry.valueMinor, currency)}
                </span>
                <Button
                  variant="subtle"
                  aria-label={`Delete ${entry.holdingName} entry of ${entry.recordedAt.slice(0, 10)}`}
                  onClick={() => onDelete(entry)}
                  disabled={deleteEntry.isPending}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {(entries.data?.length ?? 0) > SHOW_LIMIT && (
            <p className="mt-3 text-center text-xs text-ink-600">
              Showing the most recent {SHOW_LIMIT} — filter by holding to narrow down.
            </p>
          )}
        </>
      )}

      {editing && <EntryEditModal entry={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function EntryEditModal({ entry, onClose }: { entry: HistoryEntryDto; onClose: () => void }) {
  const update = useUpdateHistoryEntry();
  const [value, setValue] = useState(minorToInput(entry.valueMinor));
  const [date, setDate] = useState(entry.recordedAt.slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const valueMinor = parseToMinor(value);
    if (valueMinor === null) {
      setError('Enter a valid amount, e.g. 1250.00');
      return;
    }
    update.mutate(
      {
        side: entry.side,
        id: entry.id,
        valueMinor,
        ...(date !== entry.recordedAt.slice(0, 10) ? { recordedOn: date } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not save'),
      },
    );
  };

  return (
    <Modal title={`Edit entry — ${entry.holdingName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Date">
          {(id) => (
            <Input id={id} type="date" value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)} required />
          )}
        </Field>
        <Field label="Value">
          {(id) => (
            <Input id={id} value={value} onChange={(e) => setValue(e.target.value)}
              inputMode="decimal" required />
          )}
        </Field>
        {error ? <ErrorNote message={error} /> : null}
        <Button type="submit" className="w-full" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </Modal>
  );
}
