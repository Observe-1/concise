import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { HistoryPointDto, HistoryRange } from '@api';
import { formatMinor, formatMinorCompact } from '../lib/money.js';

export const RANGES: HistoryRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'ALL'];

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
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === r ? 'bg-gold-500 text-ink-950' : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          {r === 'ALL' ? 'All' : r}
        </button>
      ))}
    </div>
  );
}

interface ChartProps {
  points: HistoryPointDto[];
  currency: string;
  height?: number;
}

export function NetWorthChart({ points, currency, height = 240 }: ChartProps) {
  const data = useMemo(
    () => points.map((p) => ({ ...p, label: dateLabel(p.date) })),
    [points],
  );
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
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4af37" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#d4af37" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#26262c" strokeDasharray="3 6" vertical={false} />
          <XAxis
            dataKey="label"
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
          <Area
            type="monotone"
            dataKey="netWorthMinor"
            stroke="#d4af37"
            strokeWidth={2}
            fill="url(#goldFill)"
            animationDuration={300}
          />
        </AreaChart>
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
    </div>
  );
}
