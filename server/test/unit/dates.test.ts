import { describe, expect, it } from 'vitest';
import { addDays, advanceCadence, daysBetween, rangeStart } from '../../src/lib/dates.js';

describe('advanceCadence', () => {
  it('advances daily and weekly', () => {
    expect(advanceCadence('2026-06-11', 'daily')).toBe('2026-06-12');
    expect(advanceCadence('2026-06-11', 'weekly')).toBe('2026-06-18');
  });

  it('advances monthly, clamping to month end', () => {
    expect(advanceCadence('2026-01-15', 'monthly')).toBe('2026-02-15');
    expect(advanceCadence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceCadence('2024-01-31', 'monthly')).toBe('2024-02-29'); // leap year
    expect(advanceCadence('2026-12-31', 'monthly')).toBe('2027-01-31');
  });

  it('advances quarterly, clamping to month end', () => {
    expect(advanceCadence('2026-01-15', 'quarterly')).toBe('2026-04-15');
    expect(advanceCadence('2026-01-31', 'quarterly')).toBe('2026-04-30');
    expect(advanceCadence('2025-11-30', 'quarterly')).toBe('2026-02-28'); // year wrap + clamp
  });

  it('advances yearly, clamping Feb 29', () => {
    expect(advanceCadence('2024-02-29', 'yearly')).toBe('2025-02-28');
    expect(advanceCadence('2026-06-11', 'yearly')).toBe('2027-06-11');
  });
});

describe('date helpers', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('daysBetween is signed', () => {
    expect(daysBetween('2026-06-01', '2026-06-11')).toBe(10);
    expect(daysBetween('2026-06-11', '2026-06-01')).toBe(-10);
  });
});

describe('rangeStart', () => {
  const today = '2026-06-11';
  it('computes calendar-based starts', () => {
    expect(rangeStart('1M', today)).toBe('2026-05-11');
    expect(rangeStart('3M', today)).toBe('2026-03-11');
    expect(rangeStart('6M', today)).toBe('2025-12-11');
    expect(rangeStart('YTD', today)).toBe('2026-01-01');
    expect(rangeStart('1Y', today)).toBe('2025-06-11');
    expect(rangeStart('5Y', today)).toBe('2021-06-11');
    expect(rangeStart('10Y', today)).toBe('2016-06-11');
    expect(rangeStart('20Y', today)).toBe('2006-06-11');
    expect(rangeStart('ALL', today)).toBeNull();
  });

  it('clamps month-end starts', () => {
    expect(rangeStart('1M', '2026-03-31')).toBe('2026-02-28');
  });
});
