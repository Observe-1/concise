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

  it('has no prices before its data begins (2020-01-01)', () => {
    expect(provider.getPriceMinor('BTC', '2019-12-31')).toBeNull();
    expect(provider.getPriceMinor('VWRL', '2010-06-15')).toBeNull();
    expect(provider.getPriceMinor('BTC', '2020-01-01')).toBeGreaterThan(0);
  });

  it('computes holding values from quantity', () => {
    expect(holdingValueMinor(10_000, 2.5)).toBe(25_000);
    expect(holdingValueMinor(333, 0.1)).toBe(33);
  });

  it('resolves known symbols to instrument names, case-insensitively', () => {
    expect(provider.lookupSymbol('vwrl')).toEqual({
      symbol: 'VWRL', name: 'Vanguard FTSE All-World UCITS ETF',
      currency: 'GBP', exchange: 'London Stock Exchange',
    });
    expect(provider.lookupSymbol('XAU')?.name).toMatch(/gold/i);
    expect(provider.lookupSymbol('NOT-A-TICKER')).toBeNull();
  });

  it('knows instruments across several exchanges, with their currencies', () => {
    // The London-listed instrument the user wanted is available.
    expect(provider.lookupSymbol('VUAG')).toMatchObject({
      symbol: 'VUAG', currency: 'GBP', exchange: 'London Stock Exchange',
    });
    expect(provider.lookupSymbol('VOO')?.currency).toBe('USD');
    expect(provider.lookupSymbol('SAP')?.currency).toBe('EUR');
    // instrumentCurrency mirrors the lookup, defaulting unknown symbols to USD.
    expect(provider.instrumentCurrency('vuag')).toBe('GBP');
    expect(provider.instrumentCurrency('WHATEVER')).toBe('USD');
  });

  it('lists a varied instrument set for discovery', () => {
    const list = provider.listInstruments();
    expect(list.length).toBeGreaterThanOrEqual(30);
    const exchanges = new Set(list.map((i) => i.exchange));
    expect(exchanges.has('London Stock Exchange')).toBe(true);
    expect(exchanges.has('NASDAQ')).toBe(true);
    expect(list.some((i) => i.symbol === 'VUAG')).toBe(true);
  });

  it('resolves a well-formed ISIN to a deterministic synthetic fund', async () => {
    const a = await provider.resolveIsin('GB00BD3RZ582');
    const b = await provider.resolveIsin('gb00bd3rz582');
    expect(a).toEqual(b);
    expect(a?.currency).toBe('GBP'); // GB prefix
    expect(a?.symbol).toMatch(/^SIM\d+$/);
  });

  it('guesses currency from the ISIN country prefix', async () => {
    expect((await provider.resolveIsin('US0378331005'))?.currency).toBe('USD');
    expect((await provider.resolveIsin('DE0005140008'))?.currency).toBe('EUR');
  });

  it('rejects a malformed ISIN', async () => {
    expect(await provider.resolveIsin('not-an-isin')).toBeNull();
    expect(await provider.resolveIsin('GB123')).toBeNull();
  });

  it('makes a registered instrument resolvable via lookupSymbol/instrumentCurrency/listInstruments', () => {
    provider.registerInstrument('0P00018XAR.L', {
      name: 'Vanguard FTSE Global All Cp Idx £ Acc', currency: 'GBP', exchange: 'London',
    });
    expect(provider.lookupSymbol('0p00018xar.l')).toEqual({
      symbol: '0P00018XAR.L', name: 'Vanguard FTSE Global All Cp Idx £ Acc', currency: 'GBP', exchange: 'London',
    });
    expect(provider.instrumentCurrency('0P00018XAR.L')).toBe('GBP');
    expect(provider.listInstruments().some((i) => i.symbol === '0P00018XAR.L')).toBe(true);
  });

  it('has no live FX source — primeFxRates is a no-op and fxRateLive is always null', async () => {
    await expect(provider.primeFxRates(['GBP', 'EUR'])).resolves.toBeUndefined();
    expect(provider.fxRateLive('GBP')).toBeNull();
    expect(provider.fxRateLive('USD')).toBeNull();
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

  it('caps length and always keeps both endpoints', () => {
    const series = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(series, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out[0]).toBe(0); // isolated early points (legacy wealth) must survive
    expect(out[out.length - 1]).toBe(999);
    expect([...out]).toEqual([...out].sort((a, b) => a - b));
  });
});
