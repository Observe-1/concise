import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { recomputeSnapshotRange } from '../../src/modules/snapshots/service.js';

describe('historic entries editor', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;
  let assetId: number;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
    assetId = (await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 100_00, asOf: '2026-05-01' })).body.id;
    await csrf(agent.post(`/api/assets/${assetId}/valuations`)).send({ valueMinor: 150_00 });
    await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Loan', valueMinor: 50_00 });
  });

  it('lists entries across holdings, newest first, with filters', async () => {
    const all = await agent.get('/api/history/entries');
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(3);
    expect(all.body[0].holdingName).toMatch(/Savings|Loan/);
    const dates = all.body.map((e: { recordedAt: string }) => e.recordedAt);
    expect([...dates].sort().reverse()).toEqual(dates);

    const assetsOnly = await agent.get('/api/history/entries?side=asset');
    expect(assetsOnly.body).toHaveLength(2);
    expect(assetsOnly.body.every((e: { side: string }) => e.side === 'asset')).toBe(true);

    const filtered = await agent.get(`/api/history/entries?side=asset&holdingId=${assetId}`);
    expect(filtered.body).toHaveLength(2);

    await agent.get('/api/history/entries?side=boats').expect(400);
  });

  it('edits an entry value and updates current value + snapshots', async () => {
    const entries = (await agent.get(`/api/history/entries?side=asset&holdingId=${assetId}`)).body;
    const latest = entries[0]; // the 150.00 revaluation (today)
    const res = await csrf(agent.patch(`/api/history/entries/asset/${latest.id}`))
      .send({ valueMinor: 175_00 });
    expect(res.status).toBe(200);
    expect(res.body.valueMinor).toBe(175_00);

    const holding = await agent.get(`/api/assets/${assetId}`);
    expect(holding.body.currentValueMinor).toBe(175_00);
    const snap = world.ctx.db
      .prepare("SELECT assets_minor FROM snapshots WHERE snapshot_date = '2026-06-11'") // test clock's today
      .get() as { assets_minor: number };
    expect(snap.assets_minor).toBe(175_00);
  });

  it('moves an entry to a different date and rebuilds history', async () => {
    const entries = (await agent.get(`/api/history/entries?side=asset&holdingId=${assetId}`)).body;
    const original = entries[1]; // the backdated 100.00 opening entry (1 May)
    await csrf(agent.patch(`/api/history/entries/asset/${original.id}`))
      .send({ recordedOn: '2026-04-01' }).expect(200);

    const snaps = world.ctx.db
      .prepare("SELECT snapshot_date, assets_minor FROM snapshots WHERE user_id = 1 ORDER BY snapshot_date")
      .all() as { snapshot_date: string; assets_minor: number }[];
    expect(snaps[0]).toEqual({ snapshot_date: '2026-04-01', assets_minor: 100_00 });
  });

  it('rejects future dates and empty patches', async () => {
    const entries = (await agent.get('/api/history/entries?side=asset')).body;
    await csrf(agent.patch(`/api/history/entries/asset/${entries[0].id}`))
      .send({ recordedOn: '2027-01-01' }).expect(400);
    await csrf(agent.patch(`/api/history/entries/asset/${entries[0].id}`)).send({}).expect(400);
  });

  it('deletes an entry but refuses to delete the last one', async () => {
    const entries = (await agent.get(`/api/history/entries?side=asset&holdingId=${assetId}`)).body;
    await csrf(agent.delete(`/api/history/entries/asset/${entries[0].id}`)).expect(204);

    // current value falls back to the remaining entry
    const holding = await agent.get(`/api/assets/${assetId}`);
    expect(holding.body.currentValueMinor).toBe(100_00);

    const remaining = (await agent.get(`/api/history/entries?side=asset&holdingId=${assetId}`)).body;
    expect(remaining).toHaveLength(1);
    const res = await csrf(agent.delete(`/api/history/entries/asset/${remaining[0].id}`));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only entry/i);
  });

  it('enforces ownership across users', async () => {
    const entries = (await agent.get('/api/history/entries?side=asset')).body;
    createUser(world.ctx, 'mallory', 'password456');
    const mallory = await loginAgent(world.app, 'mallory', 'password456');
    expect((await mallory.get('/api/history/entries')).body).toHaveLength(0);
    await csrf(mallory.patch(`/api/history/entries/asset/${entries[0].id}`))
      .send({ valueMinor: 1 }).expect(404);
    await csrf(mallory.delete(`/api/history/entries/asset/${entries[0].id}`)).expect(404);
  });
});

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
