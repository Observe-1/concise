// Pure series helpers shared by the dashboard graph and the per-holding charts.
// Kept dependency-free (no module imports) so any layer can use them without
// creating an import cycle.

// Trend smoothing window in days. The client may override per request within
// these bounds; whatever the window, it is applied to the FULL history so a
// date's trend value is identical whatever range is requested — the trend must
// never re-fit to the visible window.
export const TREND_WINDOW_DEFAULT_DAYS = 91;
export const TREND_WINDOW_MIN_DAYS = 7;
export const TREND_WINDOW_MAX_DAYS = 365;

/** Most points any chart series is downsampled to before it leaves the API. */
export const MAX_GRAPH_POINTS = 400;

/**
 * Centred moving average over the full daily series. Returns one trend value
 * per input row (edges use the partial window). O(n) via prefix sums.
 */
export function computeTrend(values: number[], windowDays = TREND_WINDOW_DEFAULT_DAYS): number[] {
  const half = Math.floor(windowDays / 2);
  const prefix = new Array<number>(values.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    return Math.round((prefix[hi + 1]! - prefix[lo]!) / (hi - lo + 1));
  });
}

/** Thin the series to at most `max` points, always keeping both endpoints
 *  (isolated early points, e.g. legacy wealth, must survive). */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: T[] = [];
  for (let i = points.length - 1; i >= 0; i -= stride) out.push(points[i]!);
  out.reverse();
  if (out[0] !== points[0]) {
    out.unshift(points[0]!);
    if (out.length > max) out.splice(1, 1);
  }
  return out;
}
