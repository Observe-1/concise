import { useState } from 'react';
import type { HistoryRange } from '@api';
import { useHistory, useMe, useSummary } from '../api/queries.js';
import { NetWorthChart, RangePicker } from '../components/NetWorthChart.js';
import { Card, Spinner } from '../components/ui.js';
import { formatMinor } from '../lib/money.js';

const CATEGORY_LABELS: Record<string, string> = {
  cash: 'Cash', investments: 'Investments', property: 'Property', vehicles: 'Vehicles',
  crypto: 'Crypto', other: 'Other', mortgage: 'Mortgage', loan: 'Loans',
  credit_card: 'Credit cards', student_loan: 'Student loans',
};

export function DashboardPage() {
  const { data: me } = useMe();
  const summary = useSummary();
  const [range, setRange] = useState<HistoryRange>('6M');
  const [fullscreen, setFullscreen] = useState(false);
  const history = useHistory(range);

  if (summary.isLoading) return <Spinner label="Loading dashboard" />;
  if (summary.isError || !summary.data) {
    return <p role="alert" className="py-10 text-center text-sm text-loss-400">Could not load your dashboard.</p>;
  }
  const s = summary.data;
  const currency = s.currency;

  const chartSection = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <RangePicker value={range} onChange={setRange} />
        <button
          type="button"
          onClick={() => setFullscreen(!fullscreen)}
          aria-label={fullscreen ? 'Exit full screen' : 'View graph full screen'}
          className="rounded-lg p-2 text-ink-400 hover:text-gold-400"
        >
          {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
      <NetWorthChart
        points={history.data?.points ?? []}
        currency={currency}
        height={fullscreen ? Math.max(300, window.innerHeight - 160) : 240}
      />
    </>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-ink-950 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="tabular mb-2 text-lg font-semibold text-gold-400">
          {formatMinor(s.netWorthMinor, currency)}
          <span className="ml-2 text-xs font-normal uppercase tracking-wider text-ink-400">Net worth</span>
        </p>
        {chartSection}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-ink-400">
          Welcome back{me ? `, ${me.displayName}` : ''}
        </p>
        <h1 className="sr-only">Dashboard</h1>
      </header>

      <Card className="p-5">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-400">Net worth</p>
        <p className="tabular mt-1 text-3xl font-semibold text-gold-400 sm:text-4xl">
          {formatMinor(s.netWorthMinor, currency)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-ink-800/60 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Assets</p>
            <p className="tabular mt-0.5 text-lg font-semibold text-gain-400">
              {formatMinor(s.assetsMinor, currency)}
            </p>
          </div>
          <div className="rounded-xl bg-ink-800/60 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Liabilities</p>
            <p className="tabular mt-0.5 text-lg font-semibold text-loss-400">
              {formatMinor(s.liabilitiesMinor, currency)}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">{chartSection}</Card>

      {(s.assetsByCategory.length > 0 || s.liabilitiesByCategory.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          <BreakdownCard title="Assets" tone="gain" items={s.assetsByCategory} currency={currency} />
          <BreakdownCard title="Liabilities" tone="loss" items={s.liabilitiesByCategory} currency={currency} />
        </div>
      )}
    </div>
  );
}

function BreakdownCard({
  title, tone, items, currency,
}: {
  title: string;
  tone: 'gain' | 'loss';
  items: { category: string; totalMinor: number; count: number }[];
  currency: string;
}) {
  if (items.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-ink-400">{title}</h2>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.category} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink-300">
              {CATEGORY_LABELS[item.category] ?? item.category}
              <span className="ml-1.5 text-xs text-ink-600">×{item.count}</span>
            </span>
            <span className={`tabular font-medium ${tone === 'gain' ? 'text-gain-400' : 'text-loss-400'}`}>
              {formatMinor(item.totalMinor, currency)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ExpandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M11 3h4v4M7 15H3v-4M15 3l-5 5M3 15l5-5"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M7 3v4H3m12 4h-4v4M3 3l4 4m8 8l-4-4"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
