/**
 * Rough foreign-exchange conversion. A deliberately small static table (like
 * the property-index country table) of approximate rates — good enough for
 * trend-level conversion, no API keys, stable in tests. These are "rough
 * exchange rates": not kept live, but enough to keep a multi-currency portfolio
 * sensible when a value arrives in a foreign currency, or when the user changes
 * their display currency.
 *
 * Rates are expressed as units of the currency per 1 USD.
 */
export const RATES_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 156,
  CAD: 1.37,
  AUD: 1.52,
  CHF: 0.89,
  NZD: 1.66,
  SEK: 10.6,
  NOK: 10.8,
  DKK: 6.9,
  SGD: 1.35,
  HKD: 7.8,
  INR: 83,
  CNY: 7.2,
  ZAR: 18.5,
};

/** Whether a rough rate is known for a currency code. */
export function isSupportedCurrency(code: string): boolean {
  return code.toUpperCase() in RATES_PER_USD;
}

/**
 * Rate to convert an amount FROM `from` currency TO `to` currency. Unknown
 * currencies fall back to 1 (no conversion) so a typo can never zero a
 * portfolio out.
 */
export function fxRate(from: string, to: string): number {
  const f = RATES_PER_USD[from.toUpperCase()];
  const t = RATES_PER_USD[to.toUpperCase()];
  if (f === undefined || t === undefined || f === 0) return 1;
  return t / f;
}

/** Convert an integer minor-unit amount between currencies (rounded). */
export function convertMinor(amountMinor: number, from: string, to: string): number {
  if (from.toUpperCase() === to.toUpperCase()) return amountMinor;
  return Math.round(amountMinor * fxRate(from, to));
}
