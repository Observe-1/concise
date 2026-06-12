import { daysBetween } from '../../lib/dates.js';

/**
 * Model-based valuation methods: the value at any date is derived from the
 * holding's first (base) valuation by a formula, rather than typed in by the
 * user or fetched from a market feed. Used by the property index method.
 */

export interface PropertyCountry {
  name: string;
  /** Long-run average yearly property price change, percent. */
  annualRatePct: number;
}

// Long-run nominal house-price growth averages, by country. Deliberately a
// small static table (like the simulated market instruments): good enough
// for trend-level estimates, no API keys, stable in tests.
export const PROPERTY_COUNTRIES: Record<string, PropertyCountry> = {
  US: { name: 'United States', annualRatePct: 4.6 },
  GB: { name: 'United Kingdom', annualRatePct: 3.7 },
  DE: { name: 'Germany', annualRatePct: 3.1 },
  FR: { name: 'France', annualRatePct: 2.8 },
  ES: { name: 'Spain', annualRatePct: 2.2 },
  IT: { name: 'Italy', annualRatePct: 0.9 },
  NL: { name: 'Netherlands', annualRatePct: 4.3 },
  SE: { name: 'Sweden', annualRatePct: 4.2 },
  CH: { name: 'Switzerland', annualRatePct: 3.0 },
  IE: { name: 'Ireland', annualRatePct: 3.4 },
  AU: { name: 'Australia', annualRatePct: 5.4 },
  NZ: { name: 'New Zealand', annualRatePct: 5.2 },
  CA: { name: 'Canada', annualRatePct: 4.9 },
  JP: { name: 'Japan', annualRatePct: 0.7 },
};

/**
 * Property value on `dateISO`, compounding the country's yearly average
 * price change continuously from the base valuation date.
 */
export function propertyValueMinor(
  baseMinor: number,
  baseDateISO: string,
  dateISO: string,
  annualRatePct: number,
): number {
  const years = daysBetween(baseDateISO, dateISO) / 365.25;
  return Math.round(baseMinor * Math.pow(1 + annualRatePct / 100, years));
}
