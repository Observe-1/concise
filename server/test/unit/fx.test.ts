import { describe, expect, it } from 'vitest';
import { convertMinor, fxRate, isSupportedCurrency, RATES_PER_USD } from '../../src/lib/fx.js';

describe('fx', () => {
  it('returns identity for the same currency', () => {
    expect(convertMinor(123_45, 'USD', 'USD')).toBe(123_45);
    expect(fxRate('GBP', 'GBP')).toBe(1);
  });

  it('converts via USD and round-trips approximately', () => {
    const usd = 1_000_00;
    const gbp = convertMinor(usd, 'USD', 'GBP');
    expect(gbp).toBe(Math.round(usd * (RATES_PER_USD.GBP! / RATES_PER_USD.USD!)));
    // back to USD lands within a rounding cent of the original
    expect(Math.abs(convertMinor(gbp, 'GBP', 'USD') - usd)).toBeLessThanOrEqual(100);
  });

  it('handles negative amounts (net worth / fixed schedules can be negative)', () => {
    expect(convertMinor(-1_000_00, 'USD', 'GBP')).toBe(Math.round(-1_000_00 * fxRate('USD', 'GBP')));
  });

  it('falls back to no conversion for unknown currencies', () => {
    expect(fxRate('USD', 'ZZZ')).toBe(1);
    expect(convertMinor(500, 'ZZZ', 'GBP')).toBe(500);
    expect(isSupportedCurrency('gbp')).toBe(true);
    expect(isSupportedCurrency('ZZZ')).toBe(false);
  });

  it('covers every currency the settings page offers', () => {
    for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'INR', 'CNY', 'ZAR']) {
      expect(isSupportedCurrency(c)).toBe(true);
    }
  });
});
