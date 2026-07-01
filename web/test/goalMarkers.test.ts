import { describe, expect, it } from 'vitest';
import type { GoalDto, HistoryPointDto } from '@api';
import { achievedDate, goalMarkers, shortGoalLabel } from '../src/lib/goalMarkers.js';

/** A series from explicit [date, netWorth] pairs (assets track net worth). */
function nwSeries(entries: Array<[string, number]>): HistoryPointDto[] {
  return entries.map(([date, nw]) => ({
    date, assetsMinor: nw, liabilitiesMinor: 0, netWorthMinor: nw, trendMinor: nw,
  }));
}

function goal(over: Partial<GoalDto>): GoalDto {
  return {
    id: 1, name: 'Goal', goalType: 'net_worth', targetMinor: 500, liabilityId: null, liabilityName: null,
    baselineMinor: null, targetDate: null, notes: null, showOnPrediction: true, currentMinor: 100,
    progressPct: 20, etaISO: null, suggestedMonthlyMinor: null, createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

// Net worth ramps past 500 between Aug and Sep, past 1200 only in Nov.
const window = nwSeries([
  ['2026-06-01', 100],
  ['2026-07-01', 300],
  ['2026-08-01', 450],
  ['2026-09-01', 520],
  ['2026-10-01', 800],
  ['2026-11-01', 1200],
]);

describe('achievedDate', () => {
  it('is where a net-worth goal first meets its target on the plotted series', () => {
    expect(achievedDate(window, goal({ targetMinor: 500 }))).toBe('2026-09-01');
    expect(achievedDate(window, goal({ targetMinor: 100 }))).toBe('2026-06-01'); // already met
    expect(achievedDate(window, goal({ targetMinor: 5000 }))).toBeNull(); // never in window
  });

  it('ignores the server ETA for net-worth goals (the series is the source of truth)', () => {
    // ETA claims July, but net worth doesn't reach 500 until September.
    expect(achievedDate(window, goal({ targetMinor: 500, etaISO: '2026-07-01' }))).toBe('2026-09-01');
  });

  it('falls back to the snapped ETA for a payoff goal', () => {
    const payoff = goal({ goalType: 'liability_payoff', targetMinor: 0, etaISO: '2026-10-01' });
    expect(achievedDate(window, payoff)).toBe('2026-10-01');
    expect(achievedDate(window, goal({ goalType: 'liability_payoff', targetMinor: 0, etaISO: null }))).toBeNull();
    expect(achievedDate(window, goal({ goalType: 'liability_payoff', targetMinor: 0, etaISO: '2030-01-01' }))).toBeNull();
  });
});

describe('goalMarkers', () => {
  it('draws a green achieved line where the series meets the target', () => {
    const markers = goalMarkers(window, [goal({ targetMinor: 500 })]);
    expect(markers).toEqual([
      expect.objectContaining({ kind: 'achieved', x: '2026-09-01' }),
    ]);
  });

  it('draws a gold deadline line at the target date', () => {
    const markers = goalMarkers(window, [goal({ targetMinor: 5000, targetDate: '2026-08-01' })]);
    expect(markers).toEqual([
      expect.objectContaining({ kind: 'deadline', x: '2026-08-01' }),
    ]);
  });

  it('emits both a deadline and an achieved line for one goal (deadline first)', () => {
    const markers = goalMarkers(window, [goal({ targetMinor: 500, targetDate: '2026-07-01' })]);
    expect(markers.map((m) => [m.kind, m.x])).toEqual([
      ['deadline', '2026-07-01'],
      ['achieved', '2026-09-01'],
    ]);
  });

  it('skips goals toggled off or reaching neither a deadline nor achievement', () => {
    expect(goalMarkers(window, [goal({ showOnPrediction: false, targetMinor: 500, targetDate: '2026-07-01' })])).toEqual([]);
    expect(goalMarkers(window, [goal({ targetMinor: 5000, targetDate: null })])).toEqual([]);
  });

  it('draws the deadline even when achievement is off-screen', () => {
    const markers = goalMarkers(window, [goal({ targetMinor: 5000, targetDate: '2026-07-01' })]);
    expect(markers).toEqual([expect.objectContaining({ kind: 'deadline', x: '2026-07-01' })]);
  });

  it('returns nothing without goals or points', () => {
    expect(goalMarkers(window, undefined)).toEqual([]);
    expect(goalMarkers(window, [])).toEqual([]);
    expect(goalMarkers([], [goal({ targetMinor: 100 })])).toEqual([]);
  });

  it('places lines for several goals', () => {
    const markers = goalMarkers(window, [
      goal({ id: 1, name: 'A', targetMinor: 300 }),
      goal({ id: 2, name: 'B', targetMinor: 5000, targetDate: '2026-10-01' }),
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
