import { daysBetween } from '../../lib/dates.js';

/**
 * Model-based valuation methods: the value at any date is derived from the
 * holding's first (base) valuation by a formula, rather than typed in by the
 * user or fetched from a market feed. Used by the property index and vehicle
 * depreciation methods.
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

// Average vehicle depreciation by age band: steepest while the car is new,
// easing as it ages. Rates are per-year of remaining value, compounded
// continuously across the band boundaries.
const DEPRECIATION_BANDS: readonly { uptoYears: number; annualRatePct: number }[] = [
  { uptoYears: 1, annualRatePct: 20 },
  { uptoYears: 5, annualRatePct: 15 },
  { uptoYears: Infinity, annualRatePct: 10 },
];

/** A vehicle never depreciates below this fraction of its base valuation. */
const SCRAP_FLOOR_FRACTION = 0.05;

/** Remaining-value multiplier between age 0 and `ageYears`. */
function depreciationFactor(ageYears: number): number {
  let factor = 1;
  let from = 0;
  for (const band of DEPRECIATION_BANDS) {
    const upto = Math.min(ageYears, band.uptoYears);
    if (upto > from) {
      factor *= Math.pow(1 - band.annualRatePct / 100, upto - from);
      from = upto;
    }
    if (ageYears <= band.uptoYears) break;
  }
  return factor;
}

/**
 * Vehicle value on `dateISO`: average depreciation applied for the vehicle's
 * age (from its manufacture date), relative to how depreciated it already
 * was at the base valuation date, floored at scrap value.
 */
export function vehicleValueMinor(
  baseMinor: number,
  baseDateISO: string,
  manufactureDateISO: string,
  dateISO: string,
): number {
  const ageYearsAt = (iso: string) => Math.max(0, daysBetween(manufactureDateISO, iso)) / 365.25;
  const factor = depreciationFactor(ageYearsAt(dateISO)) / depreciationFactor(ageYearsAt(baseDateISO));
  return Math.max(Math.round(baseMinor * SCRAP_FLOOR_FRACTION), Math.round(baseMinor * factor));
}
