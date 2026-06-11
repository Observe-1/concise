import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';

describe('assets & liabilities API', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('requires authentication', async () => {
    const fresh = makeTestWorld();
    await fresh.app; // silence unused
    const res = await csrf((await import('supertest')).default(fresh.app).post('/api/assets'))
      .send({ category: 'cash', name: 'X', valueMinor: 1 });
    expect(res.status).toBe(401);
  });

  it('creates, lists, updates, revalues and deletes an asset', async () => {
    const created = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Checking', valueMinor: 123_45 });
    expect(created.status).toBe(201);
    expect(created.body.currentValueMinor).toBe(123_45);
    const id = created.body.id;

    const list = await agent.get('/api/assets');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Checking');

    const patched = await csrf(agent.patch(`/api/assets/${id}`)).send({ name: 'Main checking' });
    expect(patched.body.name).toBe('Main checking');

    const revalued = await csrf(agent.post(`/api/assets/${id}/valuations`)).send({ valueMinor: 200_00 });
    expect(revalued.status).toBe(201);
    expect(revalued.body.currentValueMinor).toBe(200_00);

    const detail = await agent.get(`/api/assets/${id}`);
    expect(detail.body.valuations).toHaveLength(2);
    expect(detail.body.valuations[0].valueMinor).toBe(200_00); // newest first

    await csrf(agent.delete(`/api/assets/${id}`)).expect(204);
    const after = await agent.get('/api/assets');
    expect(after.body).toHaveLength(0);
  });

  it('rejects invalid payloads', async () => {
    await csrf(agent.post('/api/assets'))
      .send({ category: 'spaceships', name: 'X', valueMinor: 1 }).expect(400);
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: '', valueMinor: 1 }).expect(400);
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'X', valueMinor: -5 }).expect(400);
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'X', valueMinor: 10.5 }).expect(400);
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'X' }).expect(400);
  });

  it('creates market-valued assets priced by the provider', async () => {
    const res = await csrf(agent.post('/api/assets')).send({
      category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'btc', quantity: 0.5,
    });
    expect(res.status).toBe(201);
    expect(res.body.marketSymbol).toBe('BTC');
    const expected = Math.round(world.ctx.prices.getPriceMinor('BTC', '2026-06-11') * 0.5);
    expect(res.body.currentValueMinor).toBe(expected);

    await csrf(agent.post('/api/assets'))
      .send({ category: 'crypto', name: 'X', valuationMode: 'market' }).expect(400);
  });

  it('creates precious metal assets with a metal sub-selection', async () => {
    const res = await csrf(agent.post('/api/assets')).send({
      category: 'precious_metals', name: 'Krugerrands', metal: 'gold', valueMinor: 950_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.metal).toBe('gold');
    expect(res.body.category).toBe('precious_metals');

    // metal is rejected on other categories
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'X', metal: 'gold', valueMinor: 1 }).expect(400);
    // unknown metals rejected
    await csrf(agent.post('/api/assets'))
      .send({ category: 'precious_metals', name: 'X', metal: 'copper', valueMinor: 1 }).expect(400);

    // moving the asset to another category clears the metal
    const moved = await csrf(agent.patch(`/api/assets/${res.body.id}`)).send({ category: 'other' });
    expect(moved.body.metal).toBeNull();
  });

  it('mirrors the structure for liabilities (no market mode)', async () => {
    const created = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'mortgage', name: 'Home loan', valueMinor: 250_000_00 });
    expect(created.status).toBe(201);
    expect(created.body.valuationMode).toBe('manual');

    await csrf(agent.post('/api/liabilities'))
      .send({ category: 'cash', name: 'X', valueMinor: 1 }).expect(400); // asset category

    const list = await agent.get('/api/liabilities');
    expect(list.body).toHaveLength(1);
  });

  it('updates the daily snapshot on every mutation', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'A', valueMinor: 100 });
    await csrf(agent.post('/api/liabilities')).send({ category: 'loan', name: 'L', valueMinor: 40 });
    const snap = world.ctx.db
      .prepare("SELECT * FROM snapshots WHERE snapshot_date = '2026-06-11'")
      .get() as { assets_minor: number; liabilities_minor: number; net_worth_minor: number };
    expect(snap.assets_minor).toBe(100);
    expect(snap.liabilities_minor).toBe(40);
    expect(snap.net_worth_minor).toBe(60);
  });

  it('enforces ownership boundaries (404 for other users data)', async () => {
    const created = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Mine', valueMinor: 1000 });
    const id = created.body.id;

    createUser(world.ctx, 'mallory', 'password456');
    const mallory = await loginAgent(world.app, 'mallory', 'password456');
    await mallory.get(`/api/assets/${id}`).expect(404);
    await csrf(mallory.patch(`/api/assets/${id}`)).send({ name: 'Stolen' }).expect(404);
    await csrf(mallory.delete(`/api/assets/${id}`)).expect(404);
    await csrf(mallory.post(`/api/assets/${id}/valuations`)).send({ valueMinor: 1 }).expect(404);

    const list = await mallory.get('/api/assets');
    expect(list.body).toHaveLength(0);
  });
});
