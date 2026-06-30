import type { GoalDto, HistoryPointDto } from '@api';

/** Longest goal name rendered in full beside a marker line; longer names are
 *  trimmed to 8 chars + an ellipsis so the label stays under 10 characters. */
const MAX_LABEL = 9;

export interface GoalMarker {
  /** ISO date of the chart point the line sits on (an existing x-axis
   *  category, so recharts can position the ReferenceLine). */
  x: string;
  /** Short label drawn beside the line — the goal name, trimmed to < 10 chars. */
  label: string;
  goal: GoalDto;
}

/** Trim a goal name to fit beside a marker: names ≥ 10 chars become 8 chars + "…". */
export function shortGoalLabel(name: string): string {
  return name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
}

/**
 * Gold marker lines for the prediction graph: one per enabled goal, placed at
 * the goal's projected ETA (snapped to the first chart point on or after it, so
 * it lands on an existing x-axis category). A goal is skipped when its line
 * can't be placed: it's toggled off (`showOnPrediction` false), it has no ETA
 * ("not on track"), or its ETA falls beyond the visible horizon (the user can
 * widen the range to bring it into view).
 */
export function goalMarkers(
  points: HistoryPointDto[],
  goals: GoalDto[] | null | undefined,
): GoalMarker[] {
  if (!goals || points.length === 0) return [];
  const last = points[points.length - 1]!.date;
  const markers: GoalMarker[] = [];
  for (const goal of goals) {
    if (!goal.showOnPrediction || !goal.etaISO) continue;
    if (goal.etaISO > last) continue; // ETA is past the projected window
    const at = points.find((p) => p.date >= goal.etaISO!);
    if (!at) continue;
    markers.push({ x: at.date, label: shortGoalLabel(goal.name), goal });
  }
  return markers;
}
