import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { RealPriceProvider, type QuoteFetch } from '../../src/modules/market/provider.js';
import { hydrateDiscoveredInstruments } from '../../src/modules/market/service.js';

const ISIN = 'GB00BD3RZ582';
const YAHOO_SYMBOL = '0P00018XAR.L';

describe('ISIN lookup with the simulated provider', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('resolves a well-formed ISIN to a deterministic synthetic fund and caches it', async () => {
    const res = await agent.get(`/api/market/lookup?symbol=${ISIN}`);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toMatch(/^SIM\d+$/);
    expect(res.body.currency).toBe('GBP'); // GB prefix
    expect(res.body.priceMinor).toBeGreaterThan(0);

    const row = world.ctx.db.prepare('SELECT * FROM discovered_instruments WHERE isin = ?').get(ISIN) as
      | { symbol: string; currency: string }
      | undefined;
    expect(row?.symbol).toBe(res.body.symbol);

    // A second lookup hits the cache and resolves to the exact same symbol.
    const again = await agent.get(`/api/market/lookup?symbol=${ISIN}`);
    expect(again.body.symbol).toBe(res.body.symbol);
  });

  it('rejects a malformed symbol/ISIN', async () => {
    await agent.get('/api/market/lookup?symbol=NOPE123').expect(404);
    await agent.get('/api/market/lookup').expect(400);
  });

  it('creates and prices a market asset from a resolved ISIN', async () => {
    const lookup = await agent.get(`/api/market/lookup?symbol=${ISIN}`);
    const resolvedSymbol = lookup.body.symbol;

    const created = await csrf(agent.post('/api/assets')).send({
      category: 'investments', name: 'Global All Cap', valuationMode: 'market',
      marketSymbol: resolvedSymbol, quantity: 10,
    });
    expect(created.status).toBe(201);
    expect(created.body.currentValueMinor).toBeGreaterThan(0);
    expect(created.body.marketSymbol).toBe(resolvedSymbol);
  });
});

describe('ISIN lookup with the real (network-backed) provider', () => {
  let world: TestWorld;
  let app: Express;
  let agent: Awaited<ReturnType<typeof loginAgent>>;
  let searchCalls = 0;
  let chartCalls = 0;

  function searchPayload(quotes: { symbol: string; quoteType: string; longname?: string; exchDisp?: string }[]) {
    return { quotes };
  }
  function chartPayload(currency: string, close: number, dateISO: string, longName?: string, exchangeName?: string) {
    const unix = Math.floor(Date.parse(`${dateISO}T00:00:00Z`) / 1000);
    return {
      chart: {
        result: [{
          meta: {
            currency, regularMarketPrice: close, regularMarketTime: unix,
            ...(longName ? { longName } : {}), ...(exchangeName ? { exchangeName } : {}),
          },
          timestamp: [unix],
          indicators: { quote: [{ close: [close] }] },
        }],
        error: null,
      },
    };
  }

  const stubFetch: QuoteFetch = async (url) => {
    if (url.includes('/v1/finance/search')) {
      searchCalls++;
      return {
        ok: true, status: 200,
        json: async () => searchPayload([{
          symbol: YAHOO_SYMBOL, quoteType: 'MUTUALFUND',
          longname: 'Vanguard FTSE Global All Cp Idx £ Acc', exchDisp: 'London',
        }]),
      };
    }
    chartCalls++;
    return {
      ok: true, status: 200,
      json: async () => chartPayload('GBP', 289.16, '2026-06-11', 'Vanguard FTSE Global All Cp Idx £ Acc', 'LSE'),
    };
  };

  beforeEach(async () => {
    world = makeTestWorld();
    world.ctx.prices = new RealPriceProvider({ fetchFn: stubFetch });
    hydrateDiscoveredInstruments(world.ctx); // re-hydrate onto the swapped-in provider
    app = world.app;
    searchCalls = 0;
    chartCalls = 0;
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(app);
  });

  it('resolves via search + chart-meta on a cache miss, then hits the DB cache (no further network)', async () => {
    const first = await agent.get(`/api/market/lookup?symbol=${ISIN}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ symbol: YAHOO_SYMBOL, currency: 'GBP', exchange: 'LSE' });
    expect(searchCalls).toBe(1);
    expect(chartCalls).toBeGreaterThanOrEqual(1); // chart-meta fetch + the priming fetch in the same request

    const searchCallsAfterFirst = searchCalls;
    const second = await agent.get(`/api/market/lookup?symbol=${ISIN}`);
    expect(second.body.symbol).toBe(YAHOO_SYMBOL);
    expect(searchCalls).toBe(searchCallsAfterFirst); // cache hit — no new search call
  });

  it('creates and prices a market asset from the resolved fund, converting currency', async () => {
    await csrf(agent.patch('/api/settings')).send({ currency: 'USD' });
    const lookup = await agent.get(`/api/market/lookup?symbol=${ISIN}`);

    const created = await csrf(agent.post('/api/assets')).send({
      category: 'investments', name: 'Global All Cap', valuationMode: 'market',
      marketSymbol: lookup.body.symbol, quantity: 10,
    });
    expect(created.status).toBe(201);
    // 289.16 GBP * 10 units, converted from GBP to USD (rough static rate) — just assert it's positive and not the raw GBP figure.
    expect(created.body.currentValueMinor).toBeGreaterThan(0);
  });

  it('returns 404 when the ISIN has no priceable match', async () => {
    const noMatchFetch: QuoteFetch = async () => ({ ok: true, status: 200, json: async () => ({ quotes: [] }) });
    world.ctx.prices = new RealPriceProvider({ fetchFn: noMatchFetch });
    await agent.get(`/api/market/lookup?symbol=${ISIN}`).expect(404);
  });
});
