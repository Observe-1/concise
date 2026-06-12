import type { HistoryPointDto } from '@api';

/**
 * A lone snapshot in the selected range must render as a normal full-width
 * gold line that hits the point — not a single dot. Duplicate the point so
 * the series spans [date, today] (or [day-before, date] when the point IS
 * today). Purely presentational; the duplicated point carries identical
 * values, so the line is flat and the tooltip stays truthful about value.
 */
export function expandSinglePoint(
  points: HistoryPointDto[],
  todayIso: string,
): HistoryPointDto[] {
  if (points.length !== 1) return points;
  const p = points[0]!;
  if (p.date < todayIso) return [p, { ...p, date: todayIso }];
  const dayBefore = new Date(Date.parse(`${p.date}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return [{ ...p, date: dayBefore }, p];
}
