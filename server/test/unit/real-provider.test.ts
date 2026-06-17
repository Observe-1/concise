import { describe, expect, it } from 'vitest';
import {
  parseYahooChart, RealPriceProvider, SimulatedPriceProvider, type QuoteFetch,
} from '../../src/modules/market/provider.js';

/** Build a Yahoo v8 chart payload from daily closes (and an optional live price). */
function chart(
  currency: string,
  days: { date: string; close: number | null }[],
  live?: { price: number; date: string },
): unknown {
  const unix = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
  return {
    chart: {
      result: [
        {
          meta: {
            currency,
            ...(live ? { regularMarketPrice: live.price, regularMarketTime: unix(live.date) } : {}),
          },
          timestamp: days.map((d) => unix(d.date)),
          indicators: { quote: [{ close: days.map((d) => d.close) }] },
        },
      ],
      error: null,
    },
  };
}

/** A fetch stub that returns a fixed payload and counts how often it is called. */
function stubFetch(payload: unknown): QuoteFetch & { calls: number } {
  const fn = Object.assign(
    async (_url: string) => {
      fn.calls++;
      return { ok: true, status: 200, json: async () => payload };
    },
    { calls: 0 },
  );
  return fn;
}

describe('parseYahooChart', () => {
  it('scales major-currency (USD) closes by 100 into minor units', () => {
    const out = parseYahooChart(chart('USD', [
      { date: '2026-06-15', close: 291.5 },
      { date: '2026-06-16', close: 299.239990234375 },
    ]));
    expect(out).toEqual([
      { dateISO: '2026-06-15', priceMinor: 29150 },
      { dateISO: '2026-06-16', priceMinor: 29924 }, // rounded
    ]);
  });

  it('treats GBp (pence) as already-minor units — no extra ×100', () => {
    // LLOY.L quotes ~104.75 pence; that is 104.75 GBP-minor-units (£1.0475).
    const out = parseYahooChart(chart('GBp', [{ date: '2026-06-16', close: 104.75 }]));
    expect(out).toEqual([{ dateISO: '2026-06-16', priceMinor: 105 }]);
  });

  it('scales GBP (pounds) closes by 100 like any major currency', () => {
    // VUSA.L quotes in GBP pounds (~£106.39) → 10639 pence (GBP minor units).
    const out = parseYahooChart(chart('GBP', [{ date: '2026-06-16', close: 106.39 }]));
    expect(out).toEqual([{ dateISO: '2026-06-16', priceMinor: 10639 }]);
  });

  it('drops days with a null/missing close and sorts by date', () => {
    const out = parseYahooChart(chart('USD', [
      { date: '2026-06-16', close: 10 },
      { date: '2026-06-15', close: null },
      { date: '2026-06-14', close: 9 },
    ]));
    expect(out.map((q) => q.dateISO)).toEqual(['2026-06-14', '2026-06-16']);
  });

  it('overlays the live regularMarketPrice onto its own day (freshest value)', () => {
    const out = parseYahooChart(chart(
      'USD',
      [{ date: '2026-06-16', close: 100 }],
      { price: 101.5, date: '2026-06-16' },
    ));
    expect(out).toEqual([{ dateISO: '2026-06-16', priceMinor: 10150 }]);
  });

  it('returns [] for an empty or malformed payload', () => {
    expect(parseYahooChart({})).toEqual([]);
    expect(parseYahooChart({ chart: { result: [] } })).toEqual([]);
    expect(parseYahooChart(null)).toEqual([]);
  });
});

describe('RealPriceProvider', () => {
  const aaplChart = chart('USD', [
    { date: '2026-06-15', close: 100 }, // Mon
    { date: '2026-06-16', close: 110 }, // Tue
    { date: '2026-06-17', close: 120 }, // Wed
    { date: '2026-06-18', close: 130 }, // Thu
    { date: '2026-06-19', close: 140 }, // Fri
  ]);

  it('falls back to the simulation until primed', () => {
    const sim = new SimulatedPriceProvider();
    const real = new RealPriceProvider({ fetchFn: stubFetch(aaplChart) });
    expect(real.getPriceMinor('AAPL', '2026-06-17')).toBe(sim.getPriceMinor('AAPL', '2026-06-17'));
  });

  it('returns the fetched price for a primed date', async () => {
    const real = new RealPriceProvider({ fetchFn: stubFetch(aaplChart) });
    await real.prime(['AAPL'], '2026-06-15', '2026-06-19');
    expect(real.getPriceMinor('AAPL', '2026-06-17')).toBe(12000);
    expect(real.getPriceMinor('AAPL', '2026-06-19')).toBe(14000);
  });

  it('carries the last trading day forward over weekends/holidays', async () => {
    const real = new RealPriceProvider({ fetchFn: stubFetch(aaplChart) });
    await real.prime(['AAPL'], '2026-06-15', '2026-06-22');
    expect(real.getPriceMinor('AAPL', '2026-06-20')).toBe(14000); // Sat → Fri's close
    expect(real.getPriceMinor('AAPL', '2026-06-21')).toBe(14000); // Sun → Fri's close
  });

  it('returns null for a date before the instrument has any data', async () => {
    const real = new RealPriceProvider({ fetchFn: stubFetch(aaplChart) });
    await real.prime(['AAPL'], '2026-06-15', '2026-06-19');
    expect(real.getPriceMinor('AAPL', '2026-06-01')).toBeNull();
  });

  it('never throws on a failed fetch and falls back to the simulation', async () => {
    const sim = new SimulatedPriceProvider();
    const failing: QuoteFetch = async () => { throw new Error('network down'); };
    const real = new RealPriceProvider({ fetchFn: failing });
    await expect(real.prime(['AAPL'], '2026-06-15', '2026-06-19')).resolves.toBeUndefined();
    expect(real.getPriceMinor('AAPL', '2026-06-17')).toBe(sim.getPriceMinor('AAPL', '2026-06-17'));
  });

  it('does not re-fetch a covered range within the TTL, but does after it', async () => {
    let now = 1_000_000;
    const fetchFn = stubFetch(aaplChart);
    const real = new RealPriceProvider({ fetchFn, nowMs: () => now, ttlMs: 60_000 });
    await real.prime(['AAPL'], '2026-06-15', '2026-06-19');
    expect(fetchFn.calls).toBe(1);
    await real.prime(['AAPL'], '2026-06-16', '2026-06-18'); // narrower, still covered + fresh
    expect(fetchFn.calls).toBe(1);
    now += 120_000; // past the TTL
    await real.prime(['AAPL'], '2026-06-15', '2026-06-19');
    expect(fetchFn.calls).toBe(2);
  });

  it('ignores symbols with no live mapping (stays on the simulation)', async () => {
    const sim = new SimulatedPriceProvider();
    const fetchFn = stubFetch(aaplChart);
    const real = new RealPriceProvider({ fetchFn });
    await real.prime(['NOT-A-TICKER'], '2026-06-15', '2026-06-19');
    expect(fetchFn.calls).toBe(0);
    expect(real.getPriceMinor('NOT-A-TICKER', '2026-06-17'))
      .toBe(sim.getPriceMinor('NOT-A-TICKER', '2026-06-17'));
  });

  it('requests the correctly-mapped Yahoo symbol', async () => {
    let url = '';
    const fetchFn: QuoteFetch = async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => aaplChart };
    };
    const real = new RealPriceProvider({ fetchFn });
    await real.prime(['BRKB'], '2026-06-15', '2026-06-19');
    expect(url).toContain('/v8/finance/chart/BRK-B?');
  });

  it('delegates instrument metadata to the shared table', () => {
    const real = new RealPriceProvider({ fetchFn: stubFetch(aaplChart) });
    expect(real.instrumentCurrency('VUAG')).toBe('GBP');
    expect(real.lookupSymbol('vusa')).toMatchObject({ symbol: 'VUSA', exchange: 'London Stock Exchange' });
    expect(real.listInstruments().length).toBeGreaterThanOrEqual(30);
  });
});
