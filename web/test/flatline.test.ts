import { describe, expect, it } from 'vitest';
import type { HistoryPointDto } from '@api';
import { expandSinglePoint } from '../src/lib/flatline.js';

const TODAY = '2026-06-12';

const point = (date: string, value = 5_000_00): HistoryPointDto => ({
  date,
  assetsMinor: value,
  liabilitiesMinor: 0,
  netWorthMinor: value,
  trendMinor: value,
});

describe('expandSinglePoint', () => {
  it('leaves empty and multi-point series unchanged', () => {
    expect(expandSinglePoint([], TODAY)).toEqual([]);
    const two = [point('2026-01-01'), point('2026-02-01')];
    expect(expandSinglePoint(two, TODAY)).toBe(two);
  });

  it('extends a past point forward to today as a flat line', () => {
    const p = point('2026-03-01');
    const out = expandSinglePoint([p], TODAY);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(p);
    expect(out[1]).toEqual({ ...p, date: TODAY });
  });

  it('extends a point dated today backwards by one day', () => {
    const p = point(TODAY);
    const out = expandSinglePoint([p], TODAY);
    expect(out.map((o) => o.date)).toEqual(['2026-06-11', TODAY]);
    // values are identical on both points — a flat line through the point
    expect(out[0]!.netWorthMinor).toBe(p.netWorthMinor);
    expect(out[1]).toEqual(p);
  });
});
