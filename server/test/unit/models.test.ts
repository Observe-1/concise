import { describe, expect, it } from 'vitest';
import {
  PROPERTY_COUNTRIES, propertyValueMinor, vehicleValueMinor,
} from '../../src/modules/market/models.js';

describe('propertyValueMinor', () => {
  it('compounds the yearly rate from the base date', () => {
    // exactly four 365.25-day years at 4% ≈ ×1.04^4
    expect(propertyValueMinor(1_000_000, '2020-01-01', '2024-01-01', 4))
      .toBe(Math.round(1_000_000 * Math.pow(1.04, 1461 / 365.25)));
    // no time elapsed → base value
    expect(propertyValueMinor(1_000_000, '2024-01-01', '2024-01-01', 4)).toBe(1_000_000);
  });

  it('ships a non-empty country table with positive-ish rates', () => {
    expect(Object.keys(PROPERTY_COUNTRIES).length).toBeGreaterThanOrEqual(10);
    for (const c of Object.values(PROPERTY_COUNTRIES)) {
      expect(c.annualRatePct).toBeGreaterThan(-10);
      expect(c.annualRatePct).toBeLessThan(20);
    }
  });
});

describe('vehicleValueMinor', () => {
  const base = 2_000_000; // a 20k car

  it('depreciates faster in the first year than later years', () => {
    // brand new car: manufacture = base date
    const afterYear1 = vehicleValueMinor(base, '2024-01-01', '2024-01-01', '2025-01-01');
    const afterYear2 = vehicleValueMinor(base, '2024-01-01', '2024-01-01', '2026-01-01');
    const lossYear1 = base - afterYear1;
    const lossYear2 = afterYear1 - afterYear2;
    expect(lossYear1).toBeGreaterThan(lossYear2);
    expect(afterYear1).toBeLessThan(base);
    expect(afterYear1).toBeGreaterThan(base * 0.7); // ~20% first-year loss
  });

  it('applies the milder rate to an already-old vehicle', () => {
    // ten-year-old car valued at base: only the 10%/yr band applies
    const after1y = vehicleValueMinor(base, '2024-01-01', '2014-01-01', '2025-01-01');
    expect(after1y / base).toBeCloseTo(0.9, 2);
  });

  it('never falls below the scrap floor', () => {
    const after50y = vehicleValueMinor(base, '2024-01-01', '2024-01-01', '2074-01-01');
    expect(after50y).toBe(Math.round(base * 0.05));
  });

  it('is the base value when no time has passed', () => {
    expect(vehicleValueMinor(base, '2024-06-01', '2020-01-01', '2024-06-01')).toBe(base);
  });
});
