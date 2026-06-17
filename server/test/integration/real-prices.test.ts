import { describe, expect, it, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { RealPriceProvider, type QuoteFetch } from '../../src/modules/market/provider.js';
import { convertMinor } from '../../src/lib/fx.js';

/** Yahoo v8 chart payload for one symbol with a single day's close + live price. */
function chartFor(currency: string, date: string, close: number): unknown {
  const unix = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  return {
    chart: {
      result: [{
        meta: { currency, regularMarketPrice: close, regularMarketTime: unix },
        timestamp: [unix],
        indicators: { quote: [{ close: [close] }] },
      }],
      error: null,
    },
  };
}

// today in the test world (helpers.FIXED_NOW)
const TODAY = '2026-06-11';

// A fetch stub that serves a fixed quote per Yahoo symbol parsed from the URL.
const PAYLOADS: Record<string, unknown> = {
  AAPL: chartFor('USD', TODAY, 300), // $300.00 → 30000 minor
  'LLOY.L': chartFor('GBp', TODAY, 100), // 100 pence → 100 GBP-minor (£1.00)
};
const stubFetch: QuoteFetch = async (url) => {
  const sym = decodeURIComponent(url.split('/chart/')[1]!.split('?')[0]!);
  const payload = PAYLOADS[sym];
  if (!payload) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => payload };
};

describe('market valuations with the real (network-backed) provider', () => {
  let world: TestWorld;
  let app: Express;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    // Swap in the real provider with a stubbed fetch. Routes read ctx.prices at
    // request time, so replacing it after buildApp is enough.
    world.ctx.prices = new RealPriceProvider({ fetchFn: stubFetch });
    app = world.app;
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(app);
  });

  it('stores a USD holding at the fetched live price (× quantity)', async () => {
    const res = await csrf(agent.post('/api/assets')).send({
      category: 'investments', name: 'Apple', valuationMode: 'market', marketSymbol: 'AAPL', quantity: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.currentValueMinor).toBe(30000 * 2); // no FX (USD user)
  });

  it('handles a GBp (pence)-quoted London holding and converts to the user currency', async () => {
    const res = await csrf(agent.post('/api/assets')).send({
      category: 'investments', name: 'Lloyds', valuationMode: 'market', marketSymbol: 'LLOY', quantity: 10,
    });
    expect(res.status).toBe(201);
    // 100 pence × 10 = 1000 GBP-minor (£10.00), then GBP → USD.
    const expected = convertMinor(1000, 'GBP', 'USD');
    expect(res.body.currentValueMinor).toBe(expected);
    expect(res.body.currentValueMinor).toBeGreaterThan(1000); // GBP is worth more than USD
  });

  it('exposes the live per-unit price through the lookup endpoint', async () => {
    const res = await agent.get('/api/market/lookup?symbol=aapl');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ symbol: 'AAPL', currency: 'USD', priceMinor: 30000 });
  });

  it('falls back to a value (not an error) when the feed cannot price a symbol', async () => {
    // VWRL has no stub payload → fetch 404s → prime stays unprimed → simulated
    // fallback price is used, so the holding is still created (never breaks).
    const res = await csrf(agent.post('/api/assets')).send({
      category: 'investments', name: 'All-World', valuationMode: 'market', marketSymbol: 'VWRL', quantity: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.currentValueMinor).toBeGreaterThan(0);
  });
});
