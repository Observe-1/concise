import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { RealPriceProvider, type QuoteFetch } from '../../src/modules/market/provider.js';
import { convertMinor } from '../../src/lib/fx.js';

/** Yahoo v8 chart payload for an FX pair ({CCY}=X), live price only. */
function fxChart(rate: number): unknown {
  return {
    chart: {
      result: [{ meta: { currency: 'USD', regularMarketPrice: rate, regularMarketTime: 1782386851 } }],
      error: null,
    },
  };
}

// A deliberately different rate from the static table's GBP: 0.79, so tests
// can prove the LIVE rate was actually used, not the static fallback.
const LIVE_GBP_PER_USD = 0.70;

const stubFxFetch: QuoteFetch = async (url) => {
  if (url.includes('GBP%3DX') || url.includes('GBP=X')) {
    return { ok: true, status: 200, json: async () => fxChart(LIVE_GBP_PER_USD) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

/** Mirrors RealPriceProvider.fxRateLive: USD is always 1, GBP is the live
 *  rate above, anything else unknown (null → static-table fallback). */
const liveRateLookup = (code: string): number | null => {
  if (code === 'USD') return 1;
  if (code === 'GBP') return LIVE_GBP_PER_USD;
  return null;
};

describe('live FX rates — currency switch', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    world.ctx.prices = new RealPriceProvider({ fetchFn: stubFxFetch });
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('uses a live rate (not the static table) when switching currency', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    await csrf(agent.patch('/api/settings')).send({ currency: 'GBP' });

    const asset = (await agent.get('/api/assets')).body[0];
    const expectedLive = convertMinor(1_000_00, 'USD', 'GBP', liveRateLookup);
    const expectedStatic = convertMinor(1_000_00, 'USD', 'GBP');
    expect(asset.currentValueMinor).toBe(expectedLive);
    expect(asset.currentValueMinor).not.toBe(expectedStatic);
  });

  it('falls back to the static table when the live fetch fails', async () => {
    world.ctx.prices = new RealPriceProvider({
      fetchFn: async () => { throw new Error('network down'); },
    });
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    await csrf(agent.patch('/api/settings')).send({ currency: 'GBP' });

    const asset = (await agent.get('/api/assets')).body[0];
    expect(asset.currentValueMinor).toBe(convertMinor(1_000_00, 'USD', 'GBP'));
  });
});

describe('live FX rates — household combined totals', () => {
  let world: TestWorld;
  let alice: Awaited<ReturnType<typeof loginAgent>>;
  let bob: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    world.ctx.prices = new RealPriceProvider({ fetchFn: stubFxFetch });
    createUser(world.ctx, 'alice', 'password123');
    createUser(world.ctx, 'bob', 'password456');
    alice = await loginAgent(world.app, 'alice', 'password123');
    bob = await loginAgent(world.app, 'bob', 'password456');
  });

  it('converts the partner total with a live rate', async () => {
    await csrf(bob.patch('/api/settings')).send({ currency: 'GBP' });
    await csrf(bob.post('/api/assets')).send({ category: 'cash', name: 'Konto', valueMinor: 500_00 });

    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    await csrf(bob.post(`/api/household/${invite.body.linkId}/accept`));

    const res = await alice.get('/api/household/combined/summary');
    expect(res.status).toBe(200);
    const expectedBobInUsd = convertMinor(500_00, 'GBP', 'USD', liveRateLookup);
    const expectedBobStatic = convertMinor(500_00, 'GBP', 'USD');
    expect(res.body.assetsMinor).toBe(expectedBobInUsd);
    expect(res.body.assetsMinor).not.toBe(expectedBobStatic);
  });
});
