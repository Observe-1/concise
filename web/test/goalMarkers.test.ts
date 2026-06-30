import { describe, expect, it } from 'vitest';
import type { GoalDto, HistoryPointDto } from '@api';
import { goalMarkers, shortGoalLabel } from '../src/lib/goalMarkers.js';

/** Daily series from `from` to `to` (inclusive). */
function series(from: string, to: string): HistoryPointDto[] {
  const points: HistoryPointDto[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    points.push({ date, assetsMinor: 1, liabilitiesMinor: 0, netWorthMinor: 1, trendMinor: 1 });
  }
  return points;
}

function goal(over: Partial<GoalDto>): GoalDto {
  return {
    id: 1, name: 'Goal', goalType: 'net_worth', targetMinor: 100, liabilityId: null, liabilityName: null,
    baselineMinor: null, targetDate: null, notes: null, showOnPrediction: true, currentMinor: 50,
    progressPct: 50, etaISO: null, suggestedMonthlyMinor: null, createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

const window = series('2026-06-01', '2026-12-01');

describe('goalMarkers', () => {
  it('draws a green achieved line at the ETA, snapped to the first point on or after it', () => {
    const markers = goalMarkers(window, [goal({ etaISO: '2026-09-01' })]);
    expect(markers).toEqual([
      expect.objectContaining({ kind: 'achieved', x: '2026-09-01' }),
    ]);
  });

  it('draws a gold deadline line at the target date', () => {
    const markers = goalMarkers(window, [goal({ targetDate: '2026-08-15' })]);
    expect(markers).toEqual([
      expect.objectContaining({ kind: 'deadline', x: '2026-08-15' }),
    ]);
  });

  it('emits both a deadline and an achieved line for one goal (deadline first)', () => {
    const markers = goalMarkers(window, [goal({ targetDate: '2026-08-01', etaISO: '2026-10-01' })]);
    expect(markers.map((m) => [m.kind, m.x])).toEqual([
      ['deadline', '2026-08-01'],
      ['achieved', '2026-10-01'],
    ]);
  });

  it('skips goals toggled off or with neither a deadline nor an ETA', () => {
    expect(goalMarkers(window, [goal({ showOnPrediction: false, etaISO: '2026-09-01', targetDate: '2026-08-01' })])).toEqual([]);
    expect(goalMarkers(window, [goal({ etaISO: null, targetDate: null })])).toEqual([]);
  });

  it('skips a deadline or ETA beyond the visible horizon', () => {
    expect(goalMarkers(window, [goal({ etaISO: '2030-01-01' })])).toEqual([]);
    expect(goalMarkers(window, [goal({ targetDate: '2030-01-01' })])).toEqual([]);
    // The in-window date still draws, even when the other is off-screen.
    const markers = goalMarkers(window, [goal({ targetDate: '2026-07-01', etaISO: '2030-01-01' })]);
    expect(markers).toEqual([expect.objectContaining({ kind: 'deadline', x: '2026-07-01' })]);
  });

  it('returns nothing without goals or points', () => {
    expect(goalMarkers(window, undefined)).toEqual([]);
    expect(goalMarkers(window, [])).toEqual([]);
    expect(goalMarkers([], [goal({ etaISO: '2026-09-01' })])).toEqual([]);
  });

  it('places lines for several goals', () => {
    const markers = goalMarkers(window, [
      goal({ id: 1, name: 'A', etaISO: '2026-07-01' }),
      goal({ id: 2, name: 'B', targetDate: '2026-10-01' }),
    ]);
    expect(markers.map((m) => [m.goal.id, m.kind, m.x])).toEqual([
      [1, 'achieved', '2026-07-01'],
      [2, 'deadline', '2026-10-01'],
    ]);
  });
});

describe('shortGoalLabel', () => {
  it('keeps names up to 18 characters as-is', () => {
    expect(shortGoalLabel('House')).toBe('House');
    expect(shortGoalLabel('Emergency fund')).toBe('Emergency fund'); // 14 chars
    expect(shortGoalLabel('Emergency fund x2')).toBe('Emergency fund x2'); // 17 chars
  });

  it('trims names longer than 18 chars to 17 chars + ellipsis', () => {
    expect(shortGoalLabel('Pay off the mortgage')).toBe('Pay off the mortg…');
    expect(shortGoalLabel('Pay off the mortgage').length).toBe(18);
  });
});
