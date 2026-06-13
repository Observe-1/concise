import { useMemo } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HistoryPointDto, HistoryRange } from '@api';
import { ageMarkers } from '../lib/ageMarkers.js';
import { expandSinglePoint } from '../lib/flatline.js';
import { formatMinor, formatMinorCompact } from '../lib/money.js';

export const RANGES: HistoryRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', '20Y', 'ALL'];

const dateLabel = (iso: string, long = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    day: long ? 'numeric' : undefined,
    month: 'short',
    year: long ? 'numeric' : '2-digit',
  });

export function RangePicker({
  value, onChange, ranges = RANGES, allLabel = 'All',
}: {
  value: HistoryRange;
  onChange: (r: HistoryRange) => void;
  /** Override the offered ranges (e.g. hide ALL in prediction mode). */
  ranges?: HistoryRange[];
  /** Label for the ALL range — "All" on the dashboard, "Max" on holdings. */
  allLabel?: string;
}) {
  return (
    <div role="group" aria-label="History range" className="flex gap-1 overflow-x-auto">
      {ranges.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === r ? 'bg-gold-500 text-ink-950' : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          {r === 'ALL' ? allLabel : r}
        </button>
      ))}
    </div>
  );
}

// Chart geometry — shared between the recharts layout and the scrubber overlay
// so the slider track lines up with the plot area (and its handle with the X
// labels). The Y axis reserves 56px on the left; margins are small.
const Y_AXIS_WIDTH = 56;
const CHART_MARGIN = { top: 8, right: 4, left: 4, bottom: 0 };

interface ChartProps {
  points: HistoryPointDto[];
  currency: string;
  range: HistoryRange;
  birthYear?: number | null;
  height?: number;
  /** "View as" mode: a red marker on the pinned date. */
  asOf?: string | null;
  /**
   * When provided, a red "view as" scrubber is drawn along the X axis (a
   * single bar, its handle aligned with the date labels). Dragging it left
   * pins the app to that date; dragging fully right (latest point) leaves the
   * mode.
   */
  scrubber?: { asOf: string | null; setAsOf: (date: string | null) => void };
  /** Prediction mode: draw a dotted "Now" line at this date (the boundary
   *  between real history and projected future). */
  nowLine?: string | null;
  /** Hide the trend line (meaningless over projected values). */
  showTrend?: boolean;
}

export function NetWorthChart({
  points, currency, range, birthYear, height = 240, asOf, scrubber, nowLine, showTrend = true,
}: ChartProps) {
  // A single point in the window is duplicated into a flat full-width series
  // so it draws as the normal gold line rather than a lone dot.
  const data = useMemo(
    () => expandSinglePoint(points, new Date().toISOString().slice(0, 10)),
    [points],
  );
  const ages = useMemo(() => ageMarkers(data, birthYear, range), [data, birthYear, range]);
  // Historical view marker must sit on an existing x-axis category: use the
  // last chart point on or before the pinned date.
  const asOfMarker = useMemo(() => {
    if (!asOf) return null;
    let best: string | null = null;
    for (const p of data) {
      if (p.date <= asOf) best = p.date;
      else break;
    }
    return best;
  }, [data, asOf]);
  // "Now" line (prediction mode): the last chart point on or before today, so
  // it lands on an existing x-axis category.
  const nowMarker = useMemo(() => {
    if (!nowLine) return null;
    let best: string | null = null;
    for (const p of data) {
      if (p.date <= nowLine) best = p.date;
      else break;
    }
    return best;
  }, [data, nowLine]);
  // A constant series needs an explicit padded domain — 'auto' would collapse
  // the Y range to a single value and pin the flat line to the plot edge.
  const yDomain = useMemo((): [number | 'auto', number | 'auto'] => {
    if (data.length === 0) return ['auto', 'auto'];
    const values = data.map((p) => p.netWorthMinor);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min !== max) return ['auto', 'auto'];
    const pad = Math.max(Math.round(Math.abs(min) * 0.1), 100);
    return [min - pad, max + pad];
  }, [data]);

  // Scrubber thumb index: the last point on or before the pinned date
  // (rightmost = live view). Only shown when there are ≥ 2 real points.
  const showScrubber = Boolean(scrubber) && points.length >= 2;
  const scrubberIdx = useMemo(() => {
    if (!scrubber?.asOf) return data.length - 1;
    let i = 0;
    for (let k = 0; k < data.length; k++) {
      if (data[k]!.date <= scrubber.asOf) i = k;
      else break;
    }
    return i;
  }, [data, scrubber?.asOf]);
  const onScrub = (i: number) => scrubber!.setAsOf(i >= data.length - 1 ? null : data[i]!.date);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-ink-400">
        No history yet — add your first asset to start tracking.
      </div>
    );
  }
  return (
    <div className="relative" style={{ height }}>
      <div className="h-full" aria-label="Net worth history chart" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4af37" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#d4af37" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#26262c" strokeDasharray="3 6" vertical={false} />
          {/* dataKey must be the unique ISO date: duplicate category values
              (e.g. formatted "Jan 26" for many points) break ReferenceLine
              position lookup. Ticks are formatted for display instead. */}
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => dateLabel(d)}
            tick={{ fill: '#8e8e98', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={(v: number) => formatMinorCompact(v, currency)}
            tick={{ fill: '#8e8e98', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={Y_AXIS_WIDTH}
            domain={yDomain}
          />
          <Tooltip content={<ChartTooltip currency={currency} />} />
          {ages.map((marker) => (
            <ReferenceLine
              key={marker.age}
              x={marker.x}
              stroke="#3f3f46"
              strokeDasharray="2 4"
              label={{
                value: `Age ${marker.age}`,
                position: 'insideTopRight',
                fill: '#8e8e98',
                fontSize: 10,
              }}
            />
          ))}
          {asOfMarker && (
            <ReferenceLine
              x={asOfMarker}
              stroke="#ef4444"
              strokeWidth={1.5}
              label={{
                value: 'Viewing',
                position: 'insideTopLeft',
                fill: '#f87171',
                fontSize: 10,
              }}
            />
          )}
          {nowMarker && (
            <ReferenceLine
              x={nowMarker}
              stroke="#d4af37"
              strokeWidth={1.5}
              strokeDasharray="3 4"
              label={{
                value: 'Now',
                position: 'insideTopRight',
                fill: '#ddc06c',
                fontSize: 10,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="netWorthMinor"
            stroke="#d4af37"
            strokeWidth={2}
            fill="url(#goldFill)"
            animationDuration={300}
          />
          {/* Trend: computed server-side over the FULL history, so its shape
              is identical whatever range is selected. Hidden in prediction
              mode, where a trend over projected values is meaningless. */}
          {showTrend && (
            <Line
              type="monotone"
              dataKey="trendMinor"
              stroke="#ecd9a0"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              dot={false}
              activeDot={false}
              animationDuration={300}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {/* "View as" scrubber, drawn along the X axis so the chart shows a single
          bar (not a separate slider row). Its track spans the plot area and the
          circle handle lines up with the date labels. */}
      {showScrubber && (
        <>
          <input
            type="range"
            min={0}
            max={data.length - 1}
            value={scrubberIdx}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label="View as date"
            title="Drag along the timeline to view your finances as they were on a past date"
            className="absolute z-10 h-1 cursor-pointer accent-loss-500"
            style={{
              left: Y_AXIS_WIDTH + CHART_MARGIN.left,
              right: CHART_MARGIN.right,
              bottom: 18,
            }}
          />
          {scrubber!.asOf && (
            <span className="tabular pointer-events-none absolute right-1 top-0 text-[10px] font-medium uppercase tracking-wider text-loss-400">
              Viewing {scrubber!.asOf}
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload: HistoryPointDto }[];
  currency: string;
}

function ChartTooltip({ active, payload, currency }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-ink-300">{dateLabel(p.date, true)}</p>
      <p className="tabular font-semibold text-gold-400">{formatMinor(p.netWorthMinor, currency)}</p>
      <p className="tabular mt-1 text-gain-400">Assets {formatMinor(p.assetsMinor, currency)}</p>
      <p className="tabular text-loss-400">Debts {formatMinor(p.liabilitiesMinor, currency)}</p>
      {typeof p.trendMinor === 'number' && (
        <p className="tabular mt-1 text-ink-400">Trend {formatMinor(p.trendMinor, currency)}</p>
      )}
    </div>
  );
}
