import { useState } from 'react';
import { useCompare, useMe } from '../api/queries.js';
import { DatePicker } from './DatePicker.js';
import { ChangeBadge, Field, Spinner } from './ui.js';
import { categoryDisplay } from '../lib/categories.js';
import { formatMinor } from '../lib/money.js';

const todayISO = () => new Date().toISOString().slice(0, 10);
const yearAgoISO = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

/** Dashboard "Compare" mode: per-holding and totals delta between two dates. */
export function CompareCard() {
  const { data: me } = useMe();
  const [from, setFrom] = useState(yearAgoISO);
  const [to, setTo] = useState(todayISO);
  const compare = useCompare(from, to);
  const currency = me?.currency ?? 'USD';

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field label="From">
          {(id) => <DatePicker id={id} value={from} max={to} onChange={setFrom} />}
        </Field>
        <Field label="To">
          {(id) => <DatePicker id={id} value={to} min={from} onChange={setTo} />}
        </Field>
      </div>

      {compare.isLoading ? (
        <Spinner label="Loading comparison" />
      ) : !compare.data ? null : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['Net worth', compare.data.netWorth],
                ['Assets', compare.data.assets],
                ['Liabilities', compare.data.liabilities],
              ] as const
            ).map(([label, t]) => (
              <div key={label} className="rounded-xl bg-ink-800/60 px-2 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-ink-400">{label}</p>
                <p className="tabular mt-0.5 text-sm font-semibold text-ink-100">
                  {formatMinor(t.deltaMinor, currency)}
                </p>
                <ChangeBadge pct={t.deltaPct} />
              </div>
            ))}
          </div>

          {compare.data.holdings.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-400">No holdings existed in this range.</p>
          ) : (
            <ul className="divide-y divide-ink-800 border-t border-ink-800">
              {compare.data.holdings.map((h) => (
                <li key={`${h.kind}-${h.id}`} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-ink-100">{h.name}</span>
                    <span className="block text-xs text-ink-400">{categoryDisplay(h.kind, h.category)}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="tabular block text-ink-100">{formatMinor(h.deltaMinor, currency)}</span>
                    <ChangeBadge pct={h.deltaPct} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
