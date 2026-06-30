import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';

describe('dashboard compare', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('reports per-holding and totals deltas between two dates', async () => {
    const asset = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    const dayZero = '2026-06-11';

    world.advanceDays(10);
    agent = await loginAgent(world.app);
    await csrf(agent.post(`/api/assets/${asset.body.id}/valuations`)).send({ valueMinor: 1_500_00 });
    const dayTen = '2026-06-21';

    const res = await agent.get(`/api/dashboard/compare?from=${dayZero}&to=${dayTen}`);
    expect(res.status).toBe(200);
    expect(res.body.holdings).toHaveLength(1);
    expect(res.body.holdings[0]).toMatchObject({
      name: 'Savings', kind: 'asset', fromMinor: 1_000_00, toMinor: 1_500_00, deltaMinor: 500_00,
    });
    expect(res.body.netWorth).toMatchObject({ fromMinor: 1_000_00, toMinor: 1_500_00, deltaMinor: 500_00 });
  });

  it('shows a holding created after the from date as 0 → value', async () => {
    const dayZero = '2026-06-11';
    world.advanceDays(10);
    agent = await loginAgent(world.app);
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'New', valueMinor: 200_00 });
    const dayTen = '2026-06-21';

    const res = await agent.get(`/api/dashboard/compare?from=${dayZero}&to=${dayTen}`);
    expect(res.body.holdings[0]).toMatchObject({ fromMinor: 0, toMinor: 200_00 });
  });

  it('rejects an inverted date range', async () => {
    await agent.get('/api/dashboard/compare?from=2026-06-21&to=2026-06-11').expect(400);
  });

  it('rejects a missing date', async () => {
    await agent.get('/api/dashboard/compare?from=2026-06-11').expect(400);
  });

  it('requires authentication', async () => {
    await request(world.app).get('/api/dashboard/compare?from=2026-06-01&to=2026-06-11').expect(401);
  });
});
