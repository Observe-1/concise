import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { HoldingCompositionDto } from '@api';
import { formatMinor } from '../lib/money.js';

// Net-worth pie palette. The selected holding is gold; assets green, debts red —
// matching the app's gain/loss tokens (see styles.css).
const GOLD = '#d4af37';
const ASSET_GREEN = '#22c55e';
const LIABILITY_RED = '#ef4444';

interface Slice {
  name: string;
  value: number;
  color: string;
}

/** Evenly-spread pastel hues so every individual holding gets a distinct,
 *  soft colour. Deterministic in the index, so colours are stable per render. */
function pastel(index: number, count: number): string {
  const hue = Math.round((360 * index) / Math.max(1, count));
  return `hsl(${hue}, 68%, 76%)`;
}

interface TooltipDatum {
  name: string;
  value: number;
}

/** Shared tooltip: a slice's name, value and share of the pie total. */
function makePieTooltip(currency: string, total: number) {
  return function PieTooltip({
    active, payload,
  }: {
    active?: boolean;
    payload?: { payload: TooltipDatum }[];
  }) {
    if (!active || !payload?.length) return null;
    const d = payload[0]!.payload;
    const pct = total > 0 ? (d.value / total) * 100 : 0;
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-950/95 px-3 py-2 text-xs shadow-xl">
        <p className="mb-0.5 font-medium text-ink-200">{d.name}</p>
        <p className="tabular font-semibold text-gold-400">{formatMinor(d.value, currency)}</p>
        <p className="tabular mt-0.5 text-ink-400">{pct.toFixed(1)}% of total</p>
      </div>
    );
  };
}

/** A small colour-swatch legend row. */
function KeyRow({ color, label, value, currency }: {
  color: string; label: string; value?: number; currency?: string;
}) {
  return (
    <li className="flex items-center gap-2 text-xs text-ink-300">
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 truncate">{label}</span>
      {value !== undefined && currency && (
        <span className="tabular ml-auto shrink-0 text-ink-400">{formatMinor(value, currency)}</span>
      )}
    </li>
  );
}

// ---------- composition pie (holding detail popup) ----------

/**
 * A holding shown as a highlighted slice of the overall net-worth pie: the
 * selected holding (gold), all other assets (green) and all other liabilities
 * (red). Hovering a slice highlights it and shows a tooltip; a colour key sits
 * below. Re-renders for the popup's view-as / prediction modes via `composition`.
 */
export function CompositionPie({
  composition, currency, selectedName, height = 200,
}: {
  composition: HoldingCompositionDto;
  currency: string;
  selectedName: string;
  height?: number;
}) {
  const [active, setActive] = useState<number | undefined>(undefined);
  const slices: Slice[] = [
    { name: selectedName, value: composition.selectedMinor, color: GOLD },
    { name: 'Other assets', value: composition.otherAssetsMinor, color: ASSET_GREEN },
    { name: 'Other liabilities', value: composition.otherLiabilitiesMinor, color: LIABILITY_RED },
  ];
  const drawn = slices.filter((s) => s.value > 0);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const Tip = makePieTooltip(currency, total);

  return (
    <div>
      <div style={{ height }} role="img" aria-label={`${selectedName} as a share of net worth`}>
        {drawn.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-500">No value to chart</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<Tip />} />
              <Pie
                data={drawn}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius="78%"
                stroke="#101012"
                strokeWidth={2}
                isAnimationActive={false}
                onMouseEnter={(_, i) => setActive(i)}
                onMouseLeave={() => setActive(undefined)}
              >
                {drawn.map((s, i) => (
                  <Cell
                    key={s.name}
                    fill={s.color}
                    fillOpacity={active === undefined || active === i ? 1 : 0.45}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <ul className="mt-2 space-y-1">
        {slices.map((s) => (
          <KeyRow key={s.name} color={s.color} label={s.name} value={s.value} currency={currency} />
        ))}
      </ul>
    </div>
  );
}

// ---------- two-level net-worth pie (dashboard) ----------

export interface PieHolding {
  id: number;
  name: string;
  value: number;
}

interface OuterSlice extends Slice {
  side: 'asset' | 'liability';
}

/**
 * Two concentric rings: the inner ring is Assets (green) vs Liabilities (red);
 * the outer ring breaks each side into its individual holdings in unique pastel
 * colours, aligned to the inner half they belong to. Hovering any segment
 * highlights it with a tooltip. The inner ring has a colour key; the outer ring
 * does not. Clicking expands to a full-screen view.
 */
export function NetWorthPie({
  assets, liabilities, currency,
}: {
  assets: PieHolding[];
  liabilities: PieHolding[];
  currency: string;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [activeInner, setActiveInner] = useState<number | undefined>(undefined);
  const [activeOuter, setActiveOuter] = useState<number | undefined>(undefined);

  const assetsTotal = assets.reduce((s, a) => s + a.value, 0);
  const liabilitiesTotal = liabilities.reduce((s, l) => s + l.value, 0);
  const total = assetsTotal + liabilitiesTotal;

  const inner: Slice[] = [
    { name: 'Assets', value: assetsTotal, color: ASSET_GREEN },
    { name: 'Liabilities', value: liabilitiesTotal, color: LIABILITY_RED },
  ];
  // Outer order MUST be all assets then all liabilities so each individual sits
  // over its inner half (both rings share the same start angle and total).
  const individuals = [
    ...assets.map((a) => ({ ...a, side: 'asset' as const })),
    ...liabilities.map((l) => ({ ...l, side: 'liability' as const })),
  ].filter((h) => h.value > 0);
  const outer: OuterSlice[] = individuals.map((h, i) => ({
    name: h.name,
    value: h.value,
    side: h.side,
    color: pastel(i, individuals.length),
  }));

  const innerDrawn = inner.filter((s) => s.value > 0);
  const Tip = makePieTooltip(currency, total);
  const empty = total <= 0;

  const chart = (large: boolean) => (
    <div
      style={{ height: large ? Math.max(320, window.innerHeight - 220) : 240 }}
      role="img"
      aria-label="Net worth composition by asset and liability"
    >
      {empty ? (
        <div className="flex h-full items-center justify-center text-sm text-ink-400">
          Add an asset or liability to see your composition.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<Tip />} />
            <Pie
              data={innerDrawn}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="55%"
              stroke="#101012"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setActiveInner(i)}
              onMouseLeave={() => setActiveInner(undefined)}
            >
              {innerDrawn.map((s, i) => (
                <Cell
                  key={s.name}
                  fill={s.color}
                  fillOpacity={activeInner === undefined || activeInner === i ? 1 : 0.5}
                />
              ))}
            </Pie>
            <Pie
              data={outer}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="80%"
              stroke="#101012"
              strokeWidth={1}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setActiveOuter(i)}
              onMouseLeave={() => setActiveOuter(undefined)}
            >
              {outer.map((s, i) => (
                <Cell
                  key={`${s.side}-${s.name}-${i}`}
                  fill={s.color}
                  fillOpacity={activeOuter === undefined || activeOuter === i ? 1 : 0.4}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  const innerKey = (
    <ul className="mt-2 flex justify-center gap-4" aria-label="Composition key">
      {inner.map((s) => (
        <KeyRow key={s.name} color={s.color} label={s.name} value={s.value} currency={currency} />
      ))}
    </ul>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-ink-950 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-widest text-ink-400">Composition</h2>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label="Exit full screen"
            className="rounded-lg p-2 text-ink-400 hover:text-gold-400"
          >
            <CollapseIcon />
          </button>
        </div>
        <div className="flex-1">{chart(true)}</div>
        {!empty && innerKey}
      </div>
    );
  }

  return (
    <div className="relative">
      {!empty && (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="View composition full screen"
          className="absolute right-0 top-0 z-10 rounded-lg p-2 text-ink-400 hover:text-gold-400"
        >
          <ExpandIcon />
        </button>
      )}
      {/* Clicking the chart area also expands it (per the full-screen-on-click
          requirement); the explicit button keeps it discoverable/accessible. */}
      <div
        onClick={() => !empty && setFullscreen(true)}
        className={empty ? undefined : 'cursor-zoom-in'}
      >
        {chart(false)}
      </div>
      {!empty && innerKey}
    </div>
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
