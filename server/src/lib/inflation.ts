/**
 * Rough inflation adjustment. A deliberately small static table of average
 * annual consumer-price inflation (percent per calendar year) — like the rough
 * FX (`lib/fx.ts`) and property-index tables: no live data source, stable in
 * tests. It powers the dashboard's "real terms" toggle, which expresses the
 * net-worth graph and its percent changes in *today's money* so that long-range
 * nominal growth is not mistaken for real progress.
 *
 * The series is a single generic blend (broadly representative of a developed
 * economy); it is intentionally approximate and not currency-specific, mirroring
 * the other rough tables. The numbers only ever scale the *shape* of the graph,
 * never the stored portfolio.
 */

/** Average annual CPI inflation (%) by calendar year. */
const ANNUAL_INFLATION_PCT: Record<number, number> = {
  2006: 2.5, 2007: 2.8, 2008: 3.8, 2009: 0.4, 2010: 1.6,
  2011: 3.1, 2012: 2.1, 2013: 1.5, 2014: 1.6, 2015: 0.5,
  2016: 1.3, 2017: 2.1, 2018: 2.4, 2019: 1.8, 2020: 1.2,
  2021: 4.7, 2022: 8.0, 2023: 5.6, 2024: 3.1, 2025: 2.9,
  2026: 2.5,
};

/** Long-run fallback rate for years outside the table. */
const DEFAULT_INFLATION_PCT = 2.5;

/** Index epoch: the price level is anchored to 1 at the start of this year.
 *  Well below any range the app offers (20Y from "now"), so every in-scope date
 *  sits above it. */
const EPOCH_YEAR = 1990;

function annualRatePct(year: number): number {
  return ANNUAL_INFLATION_PCT[year] ?? DEFAULT_INFLATION_PCT;
}

// Memoised price level at the start (Jan 1) of each year, anchored so the epoch
// year = 1, compounding the annual rates forward.
const yearStartLevel = new Map<number, number>([[EPOCH_YEAR, 1]]);

function levelAtYearStart(year: number): number {
  if (year <= EPOCH_YEAR) return 1; // clamp: nothing in scope predates the epoch
  const cached = yearStartLevel.get(year);
  if (cached !== undefined) return cached;
  const level = levelAtYearStart(year - 1) * (1 + annualRatePct(year - 1) / 100);
  yearStartLevel.set(year, level);
  return level;
}

function daysInYear(year: number): number {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
}

/**
 * Price level at a given ISO date (`YYYY-MM-DD`), interpolated linearly across
 * the calendar year. Monotonically non-decreasing for non-negative inflation.
 */
export function priceLevel(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  const year = y!;
  const start = levelAtYearStart(year);
  const end = start * (1 + annualRatePct(year) / 100);
  const dayOfYear = Math.round(
    (Date.UTC(year, m! - 1, d!) - Date.UTC(year, 0, 1)) / 86_400_000,
  );
  return start + (end - start) * (dayOfYear / daysInYear(year));
}

/**
 * Factor that converts a nominal amount *at* `fromISO` into the purchasing power
 * *at* `toISO`. For a past `fromISO` and a present `toISO` this is > 1 (past
 * money buys more in today's terms), so deflating a long history to today
 * flattens apparent growth into the honest, inflation-adjusted picture.
 */
export function realFactor(fromISO: string, toISO: string): number {
  // priceLevel is always >= 1 (anchored at 1, compounding non-negative rates),
  // so the division is always safe.
  return priceLevel(toISO) / priceLevel(fromISO);
}

/** Convert an integer minor-unit amount nominal at `fromISO` into `toISO` money. */
export function toRealMinor(amountMinor: number, fromISO: string, toISO: string): number {
  if (fromISO === toISO) return amountMinor;
  return Math.round(amountMinor * realFactor(fromISO, toISO));
}
