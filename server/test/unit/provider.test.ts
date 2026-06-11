import { describe, expect, it } from 'vitest';
import { SimulatedPriceProvider, holdingValueMinor } from '../../src/modules/market/provider.js';
import { computeTrend, downsample } from '../../src/modules/dashboard/routes.js';

describe('SimulatedPriceProvider', () => {
  const provider = new SimulatedPriceProvider();

  it('is deterministic for the same symbol and date', () => {
    expect(provider.getPriceMinor('BTC', '2026-06-11')).toBe(provider.getPriceMinor('BTC', '2026-06-11'));
    expect(provider.getPriceMinor('btc', '2026-06-11')).toBe(provider.getPriceMinor('BTC', '2026-06-11'));
  });

  it('varies across dates and symbols, always positive', () => {
    const a = provider.getPriceMinor('VWRL', '2026-06-11');
    const b = provider.getPriceMinor('VWRL', '2026-06-12');
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(provider.getPriceMinor('UNKNOWN-SYM', '2026-06-11')).toBeGreaterThan(0);
  });

  it('computes holding values from quantity', () => {
    expect(holdingValueMinor(10_000, 2.5)).toBe(25_000);
    expect(holdingValueMinor(333, 0.1)).toBe(33);
  });

  it('resolves known symbols to instrument names, case-insensitively', () => {
    expect(provider.lookupSymbol('vwrl')).toEqual({
      symbol: 'VWRL', name: 'Vanguard FTSE All-World UCITS ETF',
    });
    expect(provider.lookupSymbol('XAU')?.name).toMatch(/gold/i);
    expect(provider.lookupSymbol('NOT-A-TICKER')).toBeNull();
  });
});

describe('computeTrend', () => {
  it('preserves length and flattens noise around a constant level', () => {
    const flat = new Array(200).fill(1000);
    expect(computeTrend(flat)).toEqual(flat);

    const noisy = Array.from({ length: 200 }, (_, i) => 1000 + (i % 2 === 0 ? 50 : -50));
    const trend = computeTrend(noisy);
    expect(trend).toHaveLength(200);
    // interior trend values hug the mean far more tightly than the raw series
    for (const v of trend.slice(50, 150)) expect(Math.abs(v - 1000)).toBeLessThan(5);
  });

  it('follows a linear drift', () => {
    const rising = Array.from({ length: 300 }, (_, i) => i * 100);
    const trend = computeTrend(rising);
    expect(trend[250]!).toBeGreaterThan(trend[50]!);
    // centred window → interior trend matches the line exactly
    expect(trend[150]).toBe(15_000);
  });
});

describe('downsample', () => {
  it('returns short series unchanged', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('caps length and always keeps the last point', () => {
    const series = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(series, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out[out.length - 1]).toBe(999);
    expect([...out]).toEqual([...out].sort((a, b) => a - b));
  });
});
