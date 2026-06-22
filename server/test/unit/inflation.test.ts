import { describe, expect, it } from 'vitest';
import { priceLevel, realFactor, toRealMinor } from '../../src/lib/inflation.js';

describe('inflation', () => {
  it('price level rises monotonically over the years', () => {
    expect(priceLevel('2010-01-01')).toBeLessThan(priceLevel('2020-01-01'));
    expect(priceLevel('2020-01-01')).toBeLessThan(priceLevel('2026-01-01'));
  });

  it('interpolates within a single year', () => {
    const jan = priceLevel('2022-01-01');
    const jul = priceLevel('2022-07-02');
    const dec = priceLevel('2022-12-31');
    expect(jul).toBeGreaterThan(jan);
    expect(dec).toBeGreaterThan(jul);
  });

  it('realFactor is 1 for the same date and >1 from past to present', () => {
    expect(realFactor('2026-06-11', '2026-06-11')).toBe(1);
    expect(realFactor('2016-06-11', '2026-06-11')).toBeGreaterThan(1);
    // ... and the inverse direction shrinks today's money into the past.
    expect(realFactor('2026-06-11', '2016-06-11')).toBeLessThan(1);
  });

  it('toRealMinor scales a past amount up into today’s money and round-trips', () => {
    const today = '2026-06-11';
    expect(toRealMinor(100_00, today, today)).toBe(100_00);
    const real = toRealMinor(100_00, '2016-06-11', today);
    expect(real).toBeGreaterThan(100_00);
    // round-tripping back to the original date recovers the amount (± rounding)
    expect(toRealMinor(real, today, '2016-06-11')).toBeCloseTo(100_00, -2);
  });
});
