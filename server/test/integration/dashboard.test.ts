import { beforeEach, describe, expect, it } from 'vitest';
import { csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { seed } from '../../src/db/seed.js';

describe('dashboard API', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    seed(world.ctx.db, world.ctx.now);
    agent = await loginAgent(world.app, 'demo', 'demo');
  });

  it('summarises totals and category breakdowns', async () => {
    const res = await agent.get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    const { assetsMinor, liabilitiesMinor, netWorthMinor, assetsByCategory, liabilitiesByCategory } = res.body;
    expect(netWorthMinor).toBe(assetsMinor - liabilitiesMinor);
    expect(assetsMinor).toBeGreaterThan(0);
    expect(liabilitiesMinor).toBeGreaterThan(0);

    const categories = assetsByCategory.map((c: { category: string }) => c.category);
    expect(categories).toContain('cash');
    expect(categories).toContain('property');
    const cash = assetsByCategory.find((c: { category: string }) => c.category === 'cash');
    expect(cash.count).toBe(2);

    const catSum = assetsByCategory.reduce((s: number, c: { totalMinor: number }) => s + c.totalMinor, 0);
    expect(catSum).toBe(assetsMinor);
    expect(liabilitiesByCategory.length).toBe(3);
  });

  it('summary matches todays snapshot', async () => {
    const res = await agent.get('/api/dashboard/summary');
    const snap = world.ctx.db
      .prepare("SELECT * FROM snapshots WHERE snapshot_date = '2026-06-11'")
      .get() as { assets_minor: number; liabilities_minor: number };
    expect(res.body.assetsMinor).toBe(snap.assets_minor);
    expect(res.body.liabilitiesMinor).toBe(snap.liabilities_minor);
  });

  it('serves history for each range preset', async () => {
    for (const [range, expectedDays] of [
      ['1M', 31], ['3M', 93], ['6M', 183], ['1Y', 366],
    ] as const) {
      const res = await agent.get(`/api/dashboard/history?range=${range}`);
      expect(res.status).toBe(200);
      expect(res.body.range).toBe(range);
      const points = res.body.points;
      expect(points.length).toBeGreaterThan(20);
      expect(points.length).toBeLessThanOrEqual(Math.min(expectedDays + 1, 400));
      // ascending dates, last point is today
      expect(points[points.length - 1].date).toBe('2026-06-11');
      expect([...points].every((p, i, arr) => i === 0 || p.date > arr[i - 1]!.date)).toBe(true);
    }
  });

  it('downsamples long ranges to at most 400 points and keeps today', async () => {
    const res = await agent.get('/api/dashboard/history?range=ALL');
    expect(res.body.points.length).toBeLessThanOrEqual(400);
    expect(res.body.points[res.body.points.length - 1].date).toBe('2026-06-11');
  });

  it('accepts the extended 10Y and 20Y ranges', async () => {
    for (const range of ['10Y', '20Y'] as const) {
      const res = await agent.get(`/api/dashboard/history?range=${range}`);
      expect(res.status).toBe(200);
      expect(res.body.range).toBe(range);
      expect(res.body.points.length).toBeGreaterThan(0);
      expect(res.body.points[res.body.points.length - 1].date).toBe('2026-06-11');
    }
  });

  it('returns a trend that is stable across range changes (no per-window re-fit)', async () => {
    const all = await agent.get('/api/dashboard/history?range=ALL');
    const oneMonth = await agent.get('/api/dashboard/history?range=1M');
    const fiveYears = await agent.get('/api/dashboard/history?range=5Y');

    type Point = { date: string; trendMinor: number; netWorthMinor: number };
    const trendByDate = new Map<string, number>(
      (all.body.points as Point[]).map((p) => [p.date, p.trendMinor]),
    );
    for (const res of [oneMonth, fiveYears]) {
      for (const p of res.body.points as Point[]) {
        expect(typeof p.trendMinor).toBe('number');
        if (trendByDate.has(p.date)) {
          expect(p.trendMinor).toBe(trendByDate.get(p.date)); // identical, not re-fitted
        }
      }
    }
  });

  it('YTD starts on Jan 1', async () => {
    const res = await agent.get('/api/dashboard/history?range=YTD');
    expect(res.body.points[0].date >= '2026-01-01').toBe(true);
  });

  it('rejects unknown ranges', async () => {
    await agent.get('/api/dashboard/history?range=2W').expect(400);
  });

  it('keeps users isolated', async () => {
    const { createUser } = await import('../helpers.js');
    createUser(world.ctx, 'empty', 'password123');
    const emptyAgent = await loginAgent(world.app, 'empty', 'password123');
    const res = await emptyAgent.get('/api/dashboard/summary');
    expect(res.body.assetsMinor).toBe(0);
    expect(res.body.netWorthMinor).toBe(0);
    const history = await emptyAgent.get('/api/dashboard/history?range=ALL');
    expect(history.body.points).toHaveLength(0);
  });
});

describe('market symbol lookup', () => {
  it('resolves, normalises, and rejects symbols', async () => {
    const world = makeTestWorld();
    seed(world.ctx.db, world.ctx.now);
    const agent = await loginAgent(world.app, 'demo', 'demo');

    const known = await agent.get('/api/market/lookup?symbol=vwrl');
    expect(known.status).toBe(200);
    expect(known.body).toEqual({ symbol: 'VWRL', name: 'Vanguard FTSE All-World UCITS ETF' });

    await agent.get('/api/market/lookup?symbol=ZZZZZ').expect(404);
    await agent.get('/api/market/lookup').expect(400);
  });
});

describe('market refresh', () => {
  it('reprices market assets once per day', async () => {
    const world = makeTestWorld();
    seed(world.ctx.db, world.ctx.now);
    const agent = await loginAgent(world.app, 'demo', 'demo');

    const first = await csrf(agent.post('/api/market/refresh'));
    expect(first.status).toBe(200);
    expect(first.body.updated).toBe(3); // VWRL + BTC + XAU

    const second = await csrf(agent.post('/api/market/refresh'));
    expect(second.body.updated).toBe(0); // already priced today

    world.advanceDays(1);
    const nextDay = await csrf(agent.post('/api/market/refresh'));
    expect(nextDay.body.updated).toBe(3);
  });
});
