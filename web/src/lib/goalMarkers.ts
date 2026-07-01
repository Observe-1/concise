import type { GoalDto, HistoryPointDto } from '@api';

/** Longest goal name rendered in full beside a marker line; longer names are
 *  trimmed to (MAX_LABEL - 1) chars + an ellipsis so the label stays at most
 *  MAX_LABEL characters. */
const MAX_LABEL = 18;

/**
 * Two flavours of goal line on the prediction graph:
 *  - `deadline` — a gold line at the user's target date (when they're aiming to
 *    hit it). Drawn for any enabled goal that has a `targetDate` in view.
 *  - `achieved` — a green line at the projected ETA (when the trend says the
 *    goal is actually reached). Drawn only when that point falls inside the
 *    visible window, i.e. the goal is predicted to be met.
 * A goal can contribute both lines (aim vs. projection), one, or neither.
 */
export type GoalMarkerKind = 'deadline' | 'achieved';

export interface GoalMarker {
  /** ISO date of the chart point the line sits on (an existing x-axis
   *  category, so recharts can position the ReferenceLine). */
  x: string;
  /** Short label drawn beside the line — the goal name, trimmed to MAX_LABEL. */
  label: string;
  /** Which line this is — drives its colour (gold deadline / green achieved). */
  kind: GoalMarkerKind;
  goal: GoalDto;
}

/** Trim a goal name to fit beside a marker: names longer than MAX_LABEL chars
 *  become (MAX_LABEL - 1) chars + "…". */
export function shortGoalLabel(name: string): string {
  return name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
}

/**
 * Where a goal is projected to be achieved *on this graph*, as an existing
 * x-axis category — or null when it isn't reached within the visible window.
 *
 * For a net-worth goal this is read straight off the plotted series (the first
 * point whose projected net worth meets the target), so the green line and the
 * hover card's figures always agree — the whole point of the alignment: the
 * date the line marks is exactly where the numbers hit the objective.
 *
 * A liability-payoff goal's objective is a specific liability reaching zero,
 * which the net-worth series can't reveal, so it falls back to the server's
 * projected `etaISO`, snapped into the window.
 */
export function achievedDate(points: HistoryPointDto[], goal: GoalDto): string | null {
  if (points.length === 0) return null;
  if (goal.goalType === 'net_worth' && goal.targetMinor > 0) {
    return points.find((p) => p.netWorthMinor >= goal.targetMinor)?.date ?? null;
  }
  const last = points[points.length - 1]!.date;
  if (!goal.etaISO || goal.etaISO > last) return null;
  return points.find((p) => p.date >= goal.etaISO!)?.date ?? null;
}

/**
 * Marker lines for the prediction graph: for each enabled goal
 * (`showOnPrediction`), up to two lines snapped to an existing x-axis category
 * (the first chart point on or after the date, so recharts can place them):
 *
 *  - a gold `deadline` line at the goal's `targetDate` (the date the user is
 *    aiming for), when one is set; and
 *  - a green `achieved` line where the goal is projected to be reached — for a
 *    net-worth goal, the point the plotted series meets the target (see
 *    {@link achievedDate}); for a payoff goal, the server's `etaISO`.
 *
 * Either line is skipped when it can't be placed — the goal is toggled off, the
 * date is absent, or it falls beyond the visible horizon (the user can widen
 * the range to bring it into view).
 */
export function goalMarkers(
  points: HistoryPointDto[],
  goals: GoalDto[] | null | undefined,
): GoalMarker[] {
  if (!goals || points.length === 0) return [];
  const last = points[points.length - 1]!.date;
  // Snap a date to the first chart point on or after it; null when the date is
  // past the projected window (no category exists for it).
  const snap = (date: string): string | null =>
    (date > last ? null : points.find((p) => p.date >= date)?.date ?? null);

  const markers: GoalMarker[] = [];
  for (const goal of goals) {
    if (!goal.showOnPrediction) continue;
    const label = shortGoalLabel(goal.name);
    if (goal.targetDate) {
      const x = snap(goal.targetDate);
      if (x) markers.push({ x, label, kind: 'deadline', goal });
    }
    const achievedX = achievedDate(points, goal);
    if (achievedX) markers.push({ x: achievedX, label, kind: 'achieved', goal });
  }
  return markers;
}
