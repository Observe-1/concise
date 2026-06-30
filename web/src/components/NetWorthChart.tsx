import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import type { GoalDto, HistoryPointDto, HistoryRange } from '@api';
import { ageMarkers, type AgeMarker } from '../lib/ageMarkers.js';
import { goalMarkers, type GoalMarker } from '../lib/goalMarkers.js';
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
// so the slider track lines up with the plot area. The Y axis reserves 56px on
// the left; margins are small.
const Y_AXIS_WIDTH = 56;
const CHART_MARGIN = { top: 8, right: 4, left: 4, bottom: 0 };

// The "view as" scrubber's circular handle rides in its own lane just above
// the X-axis date labels. We reserve a taller X-axis band — a row for the
// labels, a small gap, then a lane for the handle — and push the labels to the
// bottom of it (`tickMargin`) so the circle clears them. The handle diameter
// is fixed in CSS (`.scrubber`); the offsets below were tuned against the
// measured SVG tick positions so the handle sits ~5px above the date labels.
const SCRUBBER_CIRCLE_PX = 14;
const X_AXIS_LABEL_PX = 19; // bottom row reserved for the date labels
const SCRUBBER_GAP_PX = 5; // breathing room between the labels and the handle
const SCRUBBER_BOTTOM_PX = X_AXIS_LABEL_PX + SCRUBBER_GAP_PX;
const X_AXIS_HEIGHT = SCRUBBER_BOTTOM_PX + SCRUBBER_CIRCLE_PX;
const X_AXIS_TICK_MARGIN = X_AXIS_HEIGHT - 1 - X_AXIS_LABEL_PX;

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
  /**
   * Prediction mode: gold marker lines for enabled goals, drawn at each goal's
   * projected ETA. Pass the user's goals only while predicting; omit otherwise.
   */
  goals?: GoalDto[] | null;
  /** Hide the trend line (meaningless over projected values). */
  showTrend?: boolean;
  /**
   * Single-series mode (per-holding detail chart): the tooltip shows only this
   * label + the value, instead of the net-worth / assets / debts breakdown.
   */
  valueLabel?: string;
}

export function NetWorthChart({
  points, currency, range, birthYear, height = 240, asOf, scrubber, nowLine, showTrend = true,
  valueLabel, goals,
}: ChartProps) {
  // A single point in the window is duplicated into a flat full-width series
  // so it draws as the normal gold line rather than a lone dot.
  const data = useMemo(
    () => expandSinglePoint(points, new Date().toISOString().slice(0, 10)),
    [points],
  );
  const ages = useMemo(() => ageMarkers(data, birthYear, range), [data, birthYear, range]);
  const goalLines = useMemo(() => goalMarkers(data, goals), [data, goals]);
  // Marker flags (Now / goals) flip their expand-on-hover panel to whichever
  // side keeps it on-screen, which needs the rendered chart width. The pills
  // are also sized to their measured label width, which needs the live font.
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [flagFont, setFlagFont] = useState(DEFAULT_FLAG_FONT);
  // The hovered flag's detail card. Kept in the parent (not the memoized chart
  // canvas) so opening/closing it never re-renders the heavy recharts subtree.
  const [hoveredFlag, setHoveredFlag] = useState<HoveredFlag | null>(null);
  // While a flag (or its detail card) is hovered the general tooltip stands
  // down. Tracked in a ref so the chart canvas reads it on its own tooltip
  // re-renders without us re-rendering the whole chart to flip a boolean.
  const flagSuppressRef = useRef(false);
  // Moving between the SVG line and the HTML card crosses a small gap; a short
  // grace timer keeps the card open across it (and while the card is hovered),
  // dismissing only once neither is under the cursor.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== undefined) {
      clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    }
  }, []);
  const showFlag = useCallback((info: HoveredFlag) => {
    clearHideTimer();
    flagSuppressRef.current = true;
    setHoveredFlag(info);
  }, [clearHideTimer]);
  const scheduleHideFlag = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      hideTimer.current = undefined;
      flagSuppressRef.current = false;
      setHoveredFlag(null);
    }, FLAG_HOVER_GRACE_MS);
  }, [clearHideTimer]);
  useEffect(() => clearHideTimer, [clearHideTimer]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    setChartWidth(el.clientWidth);
    const family = getComputedStyle(el).fontFamily;
    if (family) setFlagFont(`${FLAG_FONT_WEIGHT} ${FLAG_FONT_PX}px ${family}`);
    const ro = new ResizeObserver(() => setChartWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  // Detail panels (assets / liabilities / net worth, today vs predicted) for
  // every flag, keyed by id. Today's portfolio comes from the projection's
  // boundary point; each goal's predicted figures from its ETA point. Both of a
  // goal's lines (deadline + achieved) share one panel keyed by goal id.
  const flagPanels = useMemo(() => {
    const panels = new Map<string, FlagPanel>();
    const todayPoint = nowMarker ? data.find((p) => p.date === nowMarker) : undefined;
    if (nowMarker) panels.set('now', buildNowPanel(todayPoint, currency));
    const last = data[data.length - 1]?.date;
    for (const marker of goalLines) {
      const key = `goal-${marker.goal.id}`;
      if (panels.has(key)) continue;
      const { goal } = marker;
      // Predicted figures are read at the projected ETA (the achievement
      // point); omitted when the goal isn't reached within the window.
      const etaPoint = goal.etaISO && last && goal.etaISO <= last
        ? data.find((p) => p.date >= goal.etaISO!)
        : undefined;
      panels.set(key, buildGoalPanel(goal, todayPoint, etaPoint, etaPoint?.date ?? null, currency));
    }
    return panels;
  }, [data, goalLines, nowMarker, currency]);
  const hoveredPanel = hoveredFlag ? flagPanels.get(hoveredFlag.id) : undefined;
  // Goal labels that would overlap a neighbour (or the Now flag) collapse to a
  // small icon until hovered. Pixel positions are estimated from each marker's
  // index across the plot; widths are measured from the live font so the
  // crowding check matches the rendered pills.
  const collapsedMarkers = useMemo(() => {
    const collapsed = new Set<string>();
    if (chartWidth <= 0 || data.length < 2 || goalLines.length === 0) return collapsed;
    const plotLeft = Y_AXIS_WIDTH + CHART_MARGIN.left;
    const span = chartWidth - CHART_MARGIN.right - plotLeft;
    if (span <= 0) return collapsed;
    const lastIdx = data.length - 1;
    const indexByDate = new Map(data.map((p, i) => [p.date, i]));
    const pxOf = (date: string) => {
      const i = indexByDate.get(date) ?? -1;
      return i < 0 ? plotLeft : plotLeft + (i / lastIdx) * span;
    };
    const widthOf = (label: string) => flagPillWidth(label, flagFont);
    // Seed with the Now flag's footprint so a near-today goal collapses too.
    let lastRight = nowMarker ? pxOf(nowMarker) + widthOf('Now') : -Infinity;
    const sorted = [...goalLines].sort((a, b) => pxOf(a.x) - pxOf(b.x));
    for (const m of sorted) {
      const px = pxOf(m.x);
      if (px < lastRight + 4) {
        collapsed.add(markerKey(m));
        lastRight = Math.max(lastRight, px + FLAG_ICON_W);
      } else {
        lastRight = px + widthOf(m.label);
      }
    }
    return collapsed;
  }, [goalLines, data, chartWidth, nowMarker, flagFont]);
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
  const scrubberDateLabel = showScrubber ? dateLabel(data[scrubberIdx]!.date, true) : undefined;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-ink-400">
        No history yet — add your first asset to start tracking.
      </div>
    );
  }
  return (
    <div ref={containerRef} className="relative" style={{ height }}>
      <ChartCanvas
        data={data}
        currency={currency}
        valueLabel={valueLabel}
        yDomain={yDomain}
        ages={ages}
        goalLines={goalLines}
        asOfMarker={asOfMarker}
        nowMarker={nowMarker}
        collapsedMarkers={collapsedMarkers}
        chartWidth={chartWidth}
        flagFont={flagFont}
        showTrend={showTrend}
        suppressRef={flagSuppressRef}
        onFlagShow={showFlag}
        onFlagHide={scheduleHideFlag}
      />

      {/* Detail card for the hovered marker flag (Now / goal). It is itself
          hoverable, so moving onto it keeps it open; it dismisses only once
          neither the line nor the card is under the cursor (grace timer). */}
      {hoveredFlag && hoveredPanel && (
        <FlagCard
          panel={hoveredPanel}
          x={hoveredFlag.x}
          y={hoveredFlag.y}
          chartWidth={chartWidth}
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHideFlag}
        />
      )}

      {/* "View as" scrubber, drawn along the X axis so the chart shows a single
          bar (not a separate slider row). Its track spans the plot area and the
          circle handle rides in a lane just above the X-axis date labels. */}
      {showScrubber && (
        <>
          <input
            type="range"
            min={0}
            max={data.length - 1}
            value={scrubberIdx}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label="View as date"
            aria-valuetext={scrubberDateLabel}
            title="Drag along the timeline to view your finances as they were on a past date"
            className="scrubber absolute z-10 cursor-pointer"
            style={{
              left: Y_AXIS_WIDTH + CHART_MARGIN.left,
              right: CHART_MARGIN.right,
              bottom: SCRUBBER_BOTTOM_PX,
              height: SCRUBBER_CIRCLE_PX,
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

interface ChartCanvasProps {
  data: HistoryPointDto[];
  currency: string;
  valueLabel?: string;
  yDomain: [number | 'auto', number | 'auto'];
  ages: AgeMarker[];
  goalLines: GoalMarker[];
  asOfMarker: string | null;
  nowMarker: string | null;
  collapsedMarkers: Set<string>;
  chartWidth: number;
  flagFont: string;
  showTrend: boolean;
  /** Read on each tooltip re-render to suppress it while a flag is hovered. */
  suppressRef: { current: boolean };
  onFlagShow: (info: HoveredFlag) => void;
  onFlagHide: () => void;
}

/**
 * The recharts subtree — memoized so it re-renders only when its data/geometry
 * actually change, never when the hover detail card opens or closes. (The card
 * lives in the parent; tooltip suppression is read from a ref.) Hovering a flag
 * therefore costs a small HTML overlay, not a re-render of the whole 400-point
 * chart, which is what made the graph feel laggy.
 */
const ChartCanvas = memo(function ChartCanvas({
  data, currency, valueLabel, yDomain, ages, goalLines, asOfMarker, nowMarker,
  collapsedMarkers, chartWidth, flagFont, showTrend, suppressRef, onFlagShow, onFlagHide,
}: ChartCanvasProps) {
  return (
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
            height={X_AXIS_HEIGHT}
            tickMargin={X_AXIS_TICK_MARGIN}
          />
          <YAxis
            tickFormatter={(v: number) => formatMinorCompact(v, currency)}
            tick={{ fill: '#8e8e98', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={Y_AXIS_WIDTH}
            domain={yDomain}
          />
          <Tooltip content={<ChartTooltip currency={currency} valueLabel={valueLabel} suppressRef={suppressRef} />} />
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
              label={(props) => (
                <MarkerFlag
                  {...props}
                  id="now"
                  label="Now"
                  tone="now"
                  slot={0}
                  chartWidth={chartWidth}
                  flagFont={flagFont}
                  onShow={onFlagShow}
                  onHide={onFlagHide}
                />
              )}
            />
          )}
          {/* Goal markers (prediction mode): a solid gold line at each enabled
              goal's deadline, plus a green line where it's projected to be
              achieved — distinct from the dashed "Now"/age lines. Each carries
              a labelled flag below the age labels; flags that would overlap a
              neighbour collapse to a small icon until hovered. */}
          {goalLines.map((marker) => {
            const achieved = marker.kind === 'achieved';
            return (
              <ReferenceLine
                key={markerKey(marker)}
                x={marker.x}
                stroke={achieved ? ACHIEVED_STROKE : GOAL_STROKE}
                strokeWidth={1.5}
                label={(props) => (
                  <MarkerFlag
                    {...props}
                    id={`goal-${marker.goal.id}`}
                    label={marker.label}
                    tone={achieved ? 'achieved' : 'goal'}
                    slot={0}
                    collapsed={collapsedMarkers.has(markerKey(marker))}
                    chartWidth={chartWidth}
                    flagFont={flagFont}
                    onShow={onFlagShow}
                    onHide={onFlagHide}
                  />
                )}
              />
            );
          })}
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
  );
});

// ---- marker flag hover panels (Now / goals) ----

interface PanelRow { label: string; value: string }
interface PanelSectionData { heading: string; sub?: string; rows: PanelRow[] }
/** `footnote` is a muted caption under the sections — e.g. the goal deadline. */
interface FlagPanel { title: string; sections: PanelSectionData[]; footnote?: string }
/** The hovered flag's id and the pixel position of its pill, so the HTML
 *  detail card can be placed over the chart. */
interface HoveredFlag { id: string; x: number; y: number }

/** A goal contributes up to two lines (deadline + achieved); this disambiguates
 *  them for keys and the crowding check while both share one detail panel. */
const markerKey = (m: GoalMarker) => `${m.kind}-${m.goal.id}`;

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/** Assets / liabilities / net worth for a chart point, plus an optional goal
 *  percentage — the rows shown in each section of a flag's detail card. */
function portfolioRows(point: HistoryPointDto, currency: string, goalPct?: number): PanelRow[] {
  const rows: PanelRow[] = [
    { label: 'Assets', value: formatMinor(point.assetsMinor, currency) },
    { label: 'Liabilities', value: formatMinor(point.liabilitiesMinor, currency) },
    { label: 'Net worth', value: formatMinor(point.netWorthMinor, currency) },
  ];
  if (goalPct !== undefined) rows.push({ label: 'Goal', value: `${goalPct}%` });
  return rows;
}

/**
 * A goal flag's detail: the real portfolio "As of today", and (when the goal is
 * projected to be reached within the window) the projected portfolio "Currently
 * predicted" at its ETA — each with assets, liabilities, net worth and the goal
 * percentage. The predicted goal % is the projected net worth against the target
 * (a payoff goal is, by definition of its ETA line, projected complete = 100%).
 * When the goal has a deadline, a muted "at time of goal deadline · <date>"
 * caption sits under the predicted figures to set them apart from the deadline.
 */
function buildGoalPanel(
  goal: GoalDto, todayPoint: HistoryPointDto | undefined,
  etaPoint: HistoryPointDto | undefined, etaDate: string | null, currency: string,
): FlagPanel {
  const todayPct = clampPct(goal.progressPct);
  const predictedPct = goal.goalType === 'liability_payoff'
    ? 100
    : (goal.targetMinor > 0 && etaPoint ? clampPct((etaPoint.netWorthMinor / goal.targetMinor) * 100) : todayPct);
  const sections: PanelSectionData[] = [];
  if (todayPoint) sections.push({ heading: 'As of today', rows: portfolioRows(todayPoint, currency, todayPct) });
  if (etaPoint && etaDate) {
    sections.push({
      heading: 'Currently predicted', sub: dateLabel(etaDate, true), rows: portfolioRows(etaPoint, currency, predictedPct),
    });
  }
  const footnote = goal.targetDate ? `at time of goal deadline · ${dateLabel(goal.targetDate, true)}` : undefined;
  return { title: goal.name, sections, footnote };
}

/** The Now flag's detail: just the real portfolio at the projection boundary. */
function buildNowPanel(todayPoint: HistoryPointDto | undefined, currency: string): FlagPanel {
  return {
    title: 'Now',
    sections: todayPoint ? [{ heading: 'As of today', rows: portfolioRows(todayPoint, currency) }] : [],
  };
}

type FlagTone = 'now' | 'goal' | 'achieved';

interface MarkerFlagProps {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  /** Stable id used to look up this flag's detail panel. */
  id: string;
  /** Short pill label (already trimmed). */
  label: string;
  tone: FlagTone;
  /** Vertical stagger slot, so flags on nearby dates don't overlap. */
  slot: number;
  /** When set, the label is hidden behind a small icon (it would overlap a
   *  neighbour) until the line is hovered. */
  collapsed?: boolean;
  /** Rendered chart width, used to flip the pill to the on-screen side. */
  chartWidth: number;
  /** Live `weight px family` font string, so the pill is sized to the label's
   *  measured width rather than a per-character estimate. */
  flagFont: string;
  /** Opens this flag's detail card (with the pill's pixel position). */
  onShow: (info: HoveredFlag) => void;
  /** Begins dismissing the card (a grace timer lets the cursor reach it). */
  onHide: () => void;
}

// Geometry for the marker flags. They sit in a band BELOW the age-marker
// labels (which hug the very top), so the two never overlap.
const FLAG_BAND_TOP = 24;
const FLAG_ROW_H = 17;
const FLAG_H = 16;
const FLAG_PAD_X = 6;
const FLAG_CHAR_W = 6.2; // ~width of the pill font at 10px — measurement fallback
const FLAG_ICON_W = 16;  // footprint of a collapsed goal's icon
const FLAG_FONT_PX = 10;
const FLAG_FONT_WEIGHT = 700;
const DEFAULT_FLAG_FONT = `${FLAG_FONT_WEIGHT} ${FLAG_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;
// How long the detail card lingers after the cursor leaves the line, so it can
// be reached / hovered without flickering shut.
const FLAG_HOVER_GRACE_MS = 140;

// Solid goal lines: gold at the deadline, green where it's projected achieved.
const GOAL_STROKE = '#d4af37';
const ACHIEVED_STROKE = '#22c55e';

const FLAG_TONES: Record<FlagTone, { fill: string; stroke: string; text: string }> = {
  now: { fill: '#15151a', stroke: '#d4af37', text: '#ddc06c' },
  goal: { fill: '#15151a', stroke: '#b3922c', text: '#ecd9a0' },
  achieved: { fill: '#15151a', stroke: '#22c55e', text: '#86efac' },
};

// A single offscreen canvas measures pill labels against the live font. Returns
// 0 where no 2D context exists (jsdom), so callers fall back to the estimate.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureTextWidth(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== 'undefined'
      ? document.createElement('canvas').getContext('2d')
      : null;
  }
  if (!measureCtx) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Pill width for a label: its measured text width (or a per-character estimate
 *  when measurement is unavailable) plus horizontal padding on both sides. */
function flagPillWidth(label: string, font: string): number {
  const measured = measureTextWidth(label, font);
  return Math.ceil(measured > 0 ? measured : label.length * FLAG_CHAR_W) + FLAG_PAD_X * 2;
}

/**
 * A marker line's flag (Now / goal): an opaque rounded pill carrying the short
 * label, plus a full-height transparent hit area so hovering anywhere on the
 * line opens the flag's detail card (rendered as HTML by the chart, see
 * {@link FlagCard}). The pill is sized to the label's measured width and grows
 * toward whichever side keeps it on-screen.
 */
function MarkerFlag({ viewBox, id, label, tone, slot, collapsed, chartWidth, flagFont, onShow, onHide }: MarkerFlagProps) {
  const [hover, setHover] = useState(false);
  const x = viewBox?.x;
  const top = viewBox?.y ?? 0;
  const lineHeight = viewBox?.height ?? 0;
  if (typeof x !== 'number') return null;

  const colors = FLAG_TONES[tone];
  const y = top + FLAG_BAND_TOP + slot * FLAG_ROW_H;
  const enter = () => { setHover(true); onShow({ id, x, y }); };
  const leave = () => { setHover(false); onHide(); };

  // Crowded goal: show a small icon (a goal "target" dot) until hovered.
  if (collapsed && !hover) {
    const cy = y + FLAG_H / 2;
    return (
      <g onMouseEnter={enter} onMouseLeave={leave}>
        <rect x={x - 7} y={top} width={14} height={lineHeight} fill="transparent" />
        <circle cx={x} cy={cy} r={6} fill={colors.fill} stroke={colors.stroke} />
        <circle cx={x} cy={cy} r={2.2} fill={colors.stroke} />
      </g>
    );
  }

  const pillW = flagPillWidth(label, flagFont);
  const leftSide = chartWidth > 0 && x > chartWidth * 0.62;
  const textAnchor = leftSide ? 'end' : 'start';
  const textX = leftSide ? x - FLAG_PAD_X : x + FLAG_PAD_X;
  const boxX = leftSide ? x - pillW : x;

  return (
    <g onMouseEnter={enter} onMouseLeave={leave}>
      {/* Transparent (not 'none') so the whole line height is hoverable. */}
      <rect x={x - 7} y={top} width={14} height={lineHeight} fill="transparent" />
      <rect
        x={boxX}
        y={y}
        width={pillW}
        height={FLAG_H}
        rx={5}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeOpacity={hover ? 1 : 0.7}
      />
      <text x={textX} y={y + 11} textAnchor={textAnchor} fill={colors.text} fontSize={FLAG_FONT_PX} fontWeight={FLAG_FONT_WEIGHT}>
        {label}
      </text>
    </g>
  );
}

/**
 * The HTML detail card for a hovered marker flag, overlaid on the chart at the
 * pill's position. Unlike the bare SVG line it is itself hoverable: entering it
 * cancels the dismiss timer (so it stays open while the cursor is over it) and
 * leaving it restarts the timer. It flips to the line's left near the right edge
 * so it never runs off-screen.
 */
function FlagCard({
  panel, x, y, chartWidth, onMouseEnter, onMouseLeave,
}: {
  panel: FlagPanel; x: number; y: number; chartWidth: number;
  onMouseEnter: () => void; onMouseLeave: () => void;
}) {
  const leftSide = chartWidth > 0 && x > chartWidth * 0.62;
  return (
    <div
      className={`absolute z-20 w-44 ${leftSide ? '-translate-x-full' : ''}`}
      style={{ left: leftSide ? x - 8 : x + 8, top: y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="rounded-lg border border-gold-600/50 bg-ink-950/95 p-2.5 shadow-xl shadow-black/40">
        <p className="mb-1 truncate text-xs font-semibold text-gold-400">{panel.title}</p>
        {panel.sections.map((s) => (
          <div key={s.heading} className="mt-2 first:mt-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-400">
              {s.heading}
              {s.sub && <span className="ml-1 normal-case tracking-normal text-ink-600">· {s.sub}</span>}
            </p>
            <dl className="mt-1 space-y-0.5">
              {s.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <dt className="text-ink-400">{r.label}</dt>
                  <dd className="tabular font-medium text-ink-100">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {panel.footnote && (
          <p className="mt-2 text-[10px] text-ink-500">{panel.footnote}</p>
        )}
      </div>
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload: HistoryPointDto }[];
  currency: string;
  valueLabel?: string;
  /** Read live: when a marker flag (or its card) is hovered, the general
   *  tooltip stands down. A ref so flipping it doesn't re-render the chart. */
  suppressRef?: { current: boolean };
}

function ChartTooltip({ active, payload, currency, valueLabel, suppressRef }: TooltipProps) {
  if (suppressRef?.current || !active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-ink-300">{dateLabel(p.date, true)}</p>
      {valueLabel ? (
        <p className="tabular font-semibold text-gold-400">
          {valueLabel} {formatMinor(p.netWorthMinor, currency)}
        </p>
      ) : (
        <>
          <p className="tabular font-semibold text-gold-400">{formatMinor(p.netWorthMinor, currency)}</p>
          <p className="tabular mt-1 text-gain-400">Assets {formatMinor(p.assetsMinor, currency)}</p>
          <p className="tabular text-loss-400">Debts {formatMinor(p.liabilitiesMinor, currency)}</p>
          {typeof p.trendMinor === 'number' && (
            <p className="tabular mt-1 text-ink-400">Trend {formatMinor(p.trendMinor, currency)}</p>
          )}
        </>
      )}
    </div>
  );
}
