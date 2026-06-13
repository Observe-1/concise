import { useEffect, useState } from 'react';
import type { HistoryRange } from '@api';
import { useDashboardChanges, useHistory, useMe, usePrediction, useSummary } from '../api/queries.js';
import { NetWorthChart, RANGES, RangePicker } from '../components/NetWorthChart.js';
import { Card, ChangeBadge, Spinner } from '../components/ui.js';
import { useHistoricalView } from '../contexts/HistoricalView.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { categoryDisplay, type HoldingSide } from '../lib/categories.js';
import { formatMinor } from '../lib/money.js';

// Rolling-average window (days) for the trend line — slider bounds mirror the
// server's accepted trendWindow range; 91 is the server default.
const TREND_WINDOW_MIN = 7;
const TREND_WINDOW_MAX = 365;
const TREND_WINDOW_DEFAULT = 91;

// Prediction mode can't project an unbounded future, so MAX (ALL) is hidden.
const PREDICTION_RANGES = RANGES.filter((r) => r !== 'ALL');

/** Short caption for the change figure, e.g. "vs 6M ago" / "all time". */
function rangeLabel(range: HistoryRange): string {
  return range === 'ALL' ? 'all time' : `vs ${range} ago`;
}

export function DashboardPage() {
  const { data: me } = useMe();
  const { asOf, setAsOf } = useHistoricalView();
  const summary = useSummary(asOf);
  const [range, setRange] = useState<HistoryRange>('6M');
  const [fullscreen, setFullscreen] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [trendWindow, setTrendWindow] = useState(TREND_WINDOW_DEFAULT);
  // Debounced so dragging the slider doesn't fire a request per step.
  const history = useHistory(range, useDebouncedValue(trendWindow));
  const prediction = usePrediction(range, predicting);
  // Portfolio % change over the graph's selected range, shown on the cards.
  const changes = useDashboardChanges(range, asOf).data;

  // MAX has no bounded future — leaving it selected on entering prediction
  // mode would have nothing to project, so fall back to 1Y.
  useEffect(() => {
    if (predicting && range === 'ALL') setRange('1Y');
  }, [predicting, range]);

  const chartPoints = predicting ? prediction.data?.points ?? [] : history.data?.points ?? [];

  if (summary.isLoading) return <Spinner label="Loading dashboard" />;
  if (summary.isError || !summary.data) {
    return <p role="alert" className="py-10 text-center text-sm text-loss-400">Could not load your dashboard.</p>;
  }
  const s = summary.data;
  const currency = s.currency;

  const chartSection = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <RangePicker
          value={range}
          onChange={setRange}
          ranges={predicting ? PREDICTION_RANGES : RANGES}
        />
        <div className="flex shrink-0 items-center gap-2">
          {/* The trend line is hidden in prediction mode, so its slider is too. */}
          {!predicting && (
            <label
              className="flex items-center gap-2"
              title="Rolling-average window of the trend line"
            >
              <span className="tabular whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Trend {trendWindow}d
              </span>
              <input
                type="range"
                min={TREND_WINDOW_MIN}
                max={TREND_WINDOW_MAX}
                value={trendWindow}
                onChange={(e) => setTrendWindow(Number(e.target.value))}
                aria-label="Trend rolling average window in days"
                className="h-1 w-20 cursor-pointer accent-gold-500 sm:w-28"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => setFullscreen(!fullscreen)}
            aria-label={fullscreen ? 'Exit full screen' : 'View graph full screen'}
            className="rounded-lg p-2 text-ink-400 hover:text-gold-400"
          >
            {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        </div>
      </div>
      <NetWorthChart
        points={chartPoints}
        currency={currency}
        range={range}
        birthYear={me?.birthYear}
        height={fullscreen ? Math.max(300, window.innerHeight - 200) : 240}
        asOf={asOf}
        scrubber={{ asOf, setAsOf }}
        nowLine={predicting ? prediction.data?.today ?? null : null}
        showTrend={!predicting}
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
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-widest text-ink-400">Net worth</p>
          {changes && (
            <span className="flex items-baseline gap-1.5">
              <ChangeBadge pct={changes.netWorthChangePct} />
              <span className="text-[10px] uppercase tracking-wider text-ink-600">{rangeLabel(range)}</span>
            </span>
          )}
        </div>
        <p className="tabular mt-1 text-3xl font-semibold text-gold-400 sm:text-4xl">
          {formatMinor(s.netWorthMinor, currency)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-ink-800/60 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Assets</p>
            <p className="tabular mt-0.5 flex items-baseline gap-2 text-lg font-semibold text-gain-400">
              {formatMinor(s.assetsMinor, currency)}
              {changes && <ChangeBadge pct={changes.assetsChangePct} />}
            </p>
          </div>
          <div className="rounded-xl bg-ink-800/60 px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Liabilities</p>
            <p className="tabular mt-0.5 flex items-baseline gap-2 text-lg font-semibold text-loss-400">
              {formatMinor(s.liabilitiesMinor, currency)}
              {changes && <ChangeBadge pct={changes.liabilitiesChangePct} />}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">{chartSection}</Card>

      {(s.assetsByCategory.length > 0 || s.liabilitiesByCategory.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          <BreakdownCard title="Assets" tone="gain" side="asset" items={s.assetsByCategory} currency={currency} />
          <BreakdownCard title="Liabilities" tone="loss" side="liability" items={s.liabilitiesByCategory} currency={currency} />
        </div>
      )}

      {/* Prediction mode: a golden button at the bottom projects the graph into
          the future. While active a matching golden exit button floats; it
          shifts up when the red "view as" exit button is also showing so they
          don't overlap. */}
      {!predicting ? (
        <button
          type="button"
          onClick={() => setPredicting(true)}
          className="w-full rounded-xl bg-gold-500 px-4 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-gold-400"
        >
          ✨ Prediction mode
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setPredicting(false)}
          className={`tabular fixed right-4 z-50 rounded-full bg-gold-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-lg shadow-gold-500/30 transition-colors hover:bg-gold-400 ${
            asOf ? 'bottom-36 md:bottom-20' : 'bottom-20 md:bottom-6'
          }`}
        >
          ✨ Exit prediction
        </button>
      )}
    </div>
  );
}

function BreakdownCard({
  title, tone, side, items, currency,
}: {
  title: string;
  tone: 'gain' | 'loss';
  side: HoldingSide;
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
              {categoryDisplay(side, item.category)}
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
