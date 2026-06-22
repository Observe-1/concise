import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';

// Per-holding detail charts: GET /api/:kind/:id/{history,prediction,composition}.
// FIXED_NOW = 2026-06-11.
describe('per-holding chart endpoints', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;
  let checkingId: number;
  let loanId: number;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
    // Backdated checking so it has real daily history; plus another asset and a
    // liability so the composition has "other" totals to report.
    checkingId = (await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Checking', valueMinor: 100_000, asOf: '2025-01-01' })).body.id;
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 50_000 });
    loanId = (await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 30_000 })).body.id;
  });

  it('returns a daily value series shaped like the dashboard history', async () => {
    const res = await agent.get(`/api/assets/${checkingId}/history?range=ALL`);
    expect(res.status).toBe(200);
    expect(res.body.points.length).toBeGreaterThan(1);
    expect(res.body.points[0].date).toBe('2025-01-01'); // starts at the backdate
    const last = res.body.points[res.body.points.length - 1];
    expect(last.date).toBe('2026-06-11');
    expect(last.netWorthMinor).toBe(100_000);
    expect(last.assetsMinor).toBe(100_000); // asset side carries the value
    expect(last.liabilitiesMinor).toBe(0);
  });

  it('carries a liability value on the liability side', async () => {
    const res = await agent.get(`/api/liabilities/${loanId}/history?range=1Y`);
    const last = res.body.points[res.body.points.length - 1];
    expect(last.netWorthMinor).toBe(30_000);
    expect(last.liabilitiesMinor).toBe(30_000);
    expect(last.assetsMinor).toBe(0);
  });

  it('projects a holding into the future (ALL rejected)', async () => {
    const res = await agent.get(`/api/assets/${checkingId}/prediction?range=1Y`);
    expect(res.status).toBe(200);
    expect(res.body.today).toBe('2026-06-11');
    const future = res.body.points.filter((p: { date: string }) => p.date > '2026-06-11');
    expect(future.length).toBeGreaterThan(0);
    // No recurring schedule → flat projection at the current value.
    expect(future[future.length - 1].netWorthMinor).toBe(100_000);
    await agent.get(`/api/assets/${checkingId}/prediction?range=ALL`).expect(400);
  });

  it('reports the holding composition, excluding the holding from its own side', async () => {
    const asset = await agent.get(`/api/assets/${checkingId}/composition`);
    expect(asset.status).toBe(200);
    expect(asset.body).toMatchObject({
      side: 'asset',
      selectedMinor: 100_000,
      otherAssetsMinor: 50_000, // Savings
      otherLiabilitiesMinor: 30_000, // Car loan
    });

    const liability = await agent.get(`/api/liabilities/${loanId}/composition`);
    expect(liability.body).toMatchObject({
      side: 'liability',
      selectedMinor: 30_000,
      otherAssetsMinor: 150_000, // Checking + Savings
      otherLiabilitiesMinor: 0,
    });
  });

  it('composition respects a view-as date and prediction mode', async () => {
    await csrf(agent.post(`/api/assets/${checkingId}/valuations`)).send({ valueMinor: 120_000 });
    const live = await agent.get(`/api/assets/${checkingId}/composition`);
    expect(live.body.selectedMinor).toBe(120_000);

    // The selected slice uses the same gap-interpolated series as the line
    // graph: 2025-06-01 sits 151 of 526 days from the 100_000 base (2025-01-01)
    // to the 120_000 revaluation (today), so 100_000 + 20_000·151/526 ≈ 105_741.
    const asOf = await agent.get(`/api/assets/${checkingId}/composition?asOf=2025-06-01`);
    expect(asOf.body.selectedMinor).toBe(105_741);

    const predicted = await agent.get(`/api/assets/${checkingId}/composition?predict=1&range=1Y`);
    expect(predicted.status).toBe(200);
    expect(predicted.body.side).toBe('asset');
    expect(predicted.body.selectedMinor).toBe(120_000); // flat (no schedule)
  });

  it('404s for a holding the user does not own and validates input', async () => {
    createUser(world.ctx, 'bob', 'password123');
    const bob = await loginAgent(world.app, 'bob', 'password123');
    await bob.get(`/api/assets/${checkingId}/history?range=1Y`).expect(404);
    await bob.get(`/api/assets/${checkingId}/prediction?range=1Y`).expect(404);
    await bob.get(`/api/assets/${checkingId}/composition`).expect(404);

    await agent.get(`/api/assets/${checkingId}/history?range=NOPE`).expect(400);
    await agent.get(`/api/assets/${checkingId}/history?range=1Y&trendWindow=2`).expect(400);
  });
});
