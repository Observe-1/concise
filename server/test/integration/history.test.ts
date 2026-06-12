import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { recomputeSnapshotRange } from '../../src/modules/snapshots/service.js';

describe('legacy wealth', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('records a past net-worth point and shows it on the graph', async () => {
    const res = await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2020-01-15', netWorthMinor: 2_500_000 });
    expect(res.status).toBe(201);

    const list = await agent.get('/api/history/legacy');
    expect(list.body).toEqual([{ date: '2020-01-15', netWorthMinor: 2_500_000 }]);

    const history = await agent.get('/api/dashboard/history?range=ALL');
    const point = history.body.points.find((p: { date: string }) => p.date === '2020-01-15');
    expect(point).toBeDefined();
    expect(point.netWorthMinor).toBe(2_500_000);
    expect(point.assetsMinor).toBe(2_500_000);
    expect(point.liabilitiesMinor).toBe(0);
  });

  it('splits negative net worth into liabilities', async () => {
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2019-06-01', netWorthMinor: -400_000 }).expect(201);
    const history = await agent.get('/api/dashboard/history?range=ALL');
    const point = history.body.points.find((p: { date: string }) => p.date === '2019-06-01');
    expect(point.netWorthMinor).toBe(-400_000);
    expect(point.liabilitiesMinor).toBe(400_000);
    expect(point.assetsMinor).toBe(0);
  });

  it('overwrites an existing point on the same date', async () => {
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2020-01-15', netWorthMinor: 100 }).expect(201);
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2020-01-15', netWorthMinor: 999 }).expect(201);
    const list = await agent.get('/api/history/legacy');
    expect(list.body).toEqual([{ date: '2020-01-15', netWorthMinor: 999 }]);
  });

  it('rejects future or invalid dates', async () => {
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2026-06-12', netWorthMinor: 1 }).expect(400); // today
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2030-01-01', netWorthMinor: 1 }).expect(400);
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: 'yesterday', netWorthMinor: 1 }).expect(400);
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '1850-01-01', netWorthMinor: 1 }).expect(400);
  });

  it('survives snapshot recomputation (legacy is never clobbered)', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'A', valueMinor: 50_000 });
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2026-06-01', netWorthMinor: 777 }).expect(201);

    recomputeSnapshotRange(world.ctx.db, 1, '2026-05-25', '2026-06-11');

    const history = await agent.get('/api/dashboard/history?range=ALL');
    const point = history.body.points.find((p: { date: string }) => p.date === '2026-06-01');
    expect(point.netWorthMinor).toBe(777); // not recomputed from valuations
  });

  it('deletes a legacy point, restoring computed data where it exists', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'A', valueMinor: 50_000 });
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2026-06-01', netWorthMinor: 777 }).expect(201);

    await csrf(agent.delete('/api/history/legacy/2026-06-01')).expect(204);

    // Valuation (recorded today) does not cover 2026-06-01, so no computed row returns
    const history = await agent.get('/api/dashboard/history?range=ALL');
    expect(history.body.points.find((p: { date: string }) => p.date === '2026-06-01')).toBeUndefined();

    await csrf(agent.delete('/api/history/legacy/2026-06-01')).expect(404); // already gone
  });

  it('is isolated per user', async () => {
    await csrf(agent.post('/api/history/legacy'))
      .send({ date: '2020-01-15', netWorthMinor: 123 }).expect(201);
    createUser(world.ctx, 'mallory', 'password456');
    const mallory = await loginAgent(world.app, 'mallory', 'password456');
    expect((await mallory.get('/api/history/legacy')).body).toEqual([]);
    await csrf(mallory.delete('/api/history/legacy/2020-01-15')).expect(404);
  });
});
