import { useMemo } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HistoryPointDto, HistoryRange } from '@api';
import { formatMinor, formatMinorCompact } from '../lib/money.js';

export const RANGES: HistoryRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', '20Y', 'ALL'];

/** Minimum visible span (days) before the age overlay is shown (≈5 years,
 *  with a few days' tolerance for downsampling trim at the window edge). */
const AGE_OVERLAY_MIN_DAYS = 5 * 365 - 7;

const dateLabel = (iso: string, long = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    day: long ? 'numeric' : undefined,
    month: 'short',
    year: long ? 'numeric' : '2-digit',
  });

export function RangePicker({
  value, onChange,
}: { value: HistoryRange; onChange: (r: HistoryRange) => void }) {
  return (
    <div role="group" aria-label="History range" className="flex gap-1 overflow-x-auto">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === r ? 'bg-gold-500 text-ink-950' : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          {r === 'ALL' ? 'All' : r}
        </button>
      ))}
    </div>
  );
}

/**
 * Age overlay: a muted vertical line at 1 Jan of the current year (we only
 * know the birth year) labelled with the user's current age. Shown only when
 * the visible series spans ≥ 5 years.
 */
function ageMarker(
  points: HistoryPointDto[],
  birthYear: number | null | undefined,
): { x: string; age: number } | null {
  if (!birthYear || points.length < 2) return null;
  const first = points[0]!.date;
  const last = points[points.length - 1]!.date;
  const spanDays = (Date.parse(last) - Date.parse(first)) / 86_400_000;
  if (spanDays < AGE_OVERLAY_MIN_DAYS) return null;

  const currentYear = Number(last.slice(0, 4));
  const age = currentYear - birthYear;
  if (age < 0 || age > 130) return null;
  const jan1 = `${currentYear}-01-01`;
  const at = points.find((p) => p.date >= jan1);
  if (!at) return null;
  return { x: at.date, age };
}

interface ChartProps {
  points: HistoryPointDto[];
  currency: string;
  birthYear?: number | null;
  height?: number;
}

export function NetWorthChart({ points, currency, birthYear, height = 240 }: ChartProps) {
  const age = useMemo(() => ageMarker(points, birthYear), [points, birthYear]);

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-ink-400">
        No history yet — add your first asset to start tracking.
      </div>
    );
  }
  return (
    <div style={{ height }} aria-label="Net worth history chart" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
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
            width={56}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<ChartTooltip currency={currency} />} />
          {age && (
            <ReferenceLine
              x={age.x}
              stroke="#3f3f46"
              strokeDasharray="2 4"
              label={{
                value: `Age ${age.age}`,
                position: 'insideTopRight',
                fill: '#8e8e98',
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
              is identical whatever range is selected. */}
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
        </ComposedChart>
      </ResponsiveContainer>
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
