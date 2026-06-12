import { describe, expect, it } from 'vitest';
import type { HistoryPointDto } from '@api';
import { ageMarkers } from '../src/lib/ageMarkers.js';

/** Daily series from `from` to `to` (inclusive). */
function series(from: string, to: string): HistoryPointDto[] {
  const points: HistoryPointDto[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    points.push({ date, assetsMinor: 1, liabilitiesMinor: 0, netWorthMinor: 1, trendMinor: 1 });
  }
  return points;
}

// 2021-06-11 → 2026-06-11; birth year 1990 → visible year boundaries
// 2022..2026 → ages 32..36.
const fiveYears = series('2021-06-11', '2026-06-11');
const tenYears = series('2016-06-11', '2026-06-11'); // boundaries 2017..2026 → ages 27..36

describe('ageMarkers', () => {
  it('shows every age at 5Y', () => {
    const ages = ageMarkers(fiveYears, 1990, '5Y').map((m) => m.age);
    expect(ages).toEqual([32, 33, 34, 35, 36]);
  });

  it('shows every 2nd age at 10Y (multiples of 2)', () => {
    const ages = ageMarkers(tenYears, 1990, '10Y').map((m) => m.age);
    expect(ages).toEqual([28, 30, 32, 34, 36]);
  });

  it('shows every 4th age at 20Y (multiples of 4)', () => {
    const ages = ageMarkers(tenYears, 1990, '20Y').map((m) => m.age);
    expect(ages).toEqual([28, 32, 36]);
  });

  it('shows every 5th age on All (multiples of 5)', () => {
    const ages = ageMarkers(tenYears, 1990, 'ALL').map((m) => m.age);
    expect(ages).toEqual([30, 35]);
  });

  it('places markers at the 1 Jan point of each year', () => {
    const markers = ageMarkers(fiveYears, 1990, '5Y');
    expect(markers[0]).toEqual({ x: '2022-01-01', age: 32 });
    expect(markers[markers.length - 1]).toEqual({ x: '2026-01-01', age: 36 });
  });

  it('shows nothing for short ranges, short spans, or no birth year', () => {
    expect(ageMarkers(fiveYears, 1990, '1M')).toEqual([]);
    expect(ageMarkers(fiveYears, 1990, '1Y')).toEqual([]);
    expect(ageMarkers(series('2024-01-01', '2026-06-11'), 1990, 'ALL')).toEqual([]); // < 5y data
    expect(ageMarkers(fiveYears, null, '5Y')).toEqual([]);
  });

  it('skips year boundaries that fall off-screen to the left', () => {
    // Window starts 2021-06-11, so the 2021 boundary (age 31) is not visible.
    const ages = ageMarkers(fiveYears, 1990, '5Y').map((m) => m.age);
    expect(ages).not.toContain(31);
  });

  it('ignores implausible ages', () => {
    expect(ageMarkers(fiveYears, 2030, '5Y')).toEqual([]); // negative ages
  });
});
