import type { HistoryPointDto, HistoryRange } from '@api';

/** Minimum visible span (days) before age markers are shown (≈5 years,
 *  with a few days' tolerance for downsampling trim at the window edge). */
const MIN_SPAN_DAYS = 5 * 365 - 7;

/**
 * Marker density per range: show ages that are multiples of the step, so the
 * labels stay sparse as the window grows (every age at 5Y, every 2nd at 10Y,
 * every 4th at 20Y, every 5th on All). Short ranges never show markers.
 */
const AGE_STEP: Partial<Record<HistoryRange, number>> = {
  '5Y': 1,
  '10Y': 2,
  '20Y': 4,
  ALL: 5,
};

export interface AgeMarker {
  /** ISO date of the chart point the marker sits on (x-axis category). */
  x: string;
  age: number;
}

/**
 * Vertical age markers for the chart: one at 1 Jan of each year whose age
 * matches the range's step (we only know the birth year, so year boundaries
 * stand in for birthdays). Only year boundaries actually inside the visible
 * window qualify, and only when the window spans ≥ 5 years.
 */
export function ageMarkers(
  points: HistoryPointDto[],
  birthYear: number | null | undefined,
  range: HistoryRange,
): AgeMarker[] {
  const step = AGE_STEP[range];
  if (!step || !birthYear || points.length < 2) return [];

  const first = points[0]!.date;
  const last = points[points.length - 1]!.date;
  const spanDays = (Date.parse(last) - Date.parse(first)) / 86_400_000;
  if (spanDays < MIN_SPAN_DAYS) return [];

  const markers: AgeMarker[] = [];
  const firstYear = Number(first.slice(0, 4));
  const lastYear = Number(last.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    const age = year - birthYear;
    if (age < 1 || age > 130 || age % step !== 0) continue;
    const jan1 = `${year}-01-01`;
    if (jan1 < first) continue; // boundary is off-screen to the left
    const at = points.find((p) => p.date >= jan1);
    if (!at || at.date > `${year}-12-31`) continue;
    if (markers.length > 0 && markers[markers.length - 1]!.x === at.date) continue;
    markers.push({ x: at.date, age });
  }
  return markers;
}
