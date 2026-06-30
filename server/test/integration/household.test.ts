import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';

describe('household links', () => {
  let world: TestWorld;
  let alice: Awaited<ReturnType<typeof loginAgent>>;
  let bob: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    createUser(world.ctx, 'bob', 'password456');
    alice = await loginAgent(world.app, 'alice', 'password123');
    bob = await loginAgent(world.app, 'bob', 'password456');
  });

  it('runs the full invite, accept and unlink lifecycle', async () => {
    expect((await alice.get('/api/household/status')).body).toMatchObject({ state: 'none' });

    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    expect(invite.status).toBe(201);
    const linkId = invite.body.linkId;

    expect((await alice.get('/api/household/status')).body).toMatchObject({
      state: 'pending-sent', linkId, partnerUsername: 'bob',
    });
    expect((await bob.get('/api/household/status')).body).toMatchObject({
      state: 'pending-received', linkId, partnerUsername: 'alice',
    });

    await csrf(bob.post(`/api/household/${linkId}/accept`)).expect(200);

    expect((await alice.get('/api/household/status')).body).toMatchObject({ state: 'accepted' });
    expect((await bob.get('/api/household/status')).body).toMatchObject({ state: 'accepted' });

    await csrf(alice.delete(`/api/household/${linkId}`)).expect(204);
    expect((await alice.get('/api/household/status')).body).toMatchObject({ state: 'none' });
    expect((await bob.get('/api/household/status')).body).toMatchObject({ state: 'none' });
  });

  it('lets the recipient decline an invite, freeing the pair to re-invite', async () => {
    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    await csrf(bob.post(`/api/household/${invite.body.linkId}/decline`)).expect(204);

    expect((await alice.get('/api/household/status')).body).toMatchObject({ state: 'none' });

    // Free to invite again.
    const second = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    expect(second.status).toBe(201);
  });

  it('rejects a self-invite', async () => {
    await csrf(alice.post('/api/household/invite')).send({ username: 'alice' }).expect(400);
  });

  it('rejects inviting an unknown username', async () => {
    await csrf(alice.post('/api/household/invite')).send({ username: 'nobody' }).expect(400);
  });

  it('enforces one active link per user (pairwise only)', async () => {
    createUser(world.ctx, 'carol', 'password789');
    await csrf(alice.post('/api/household/invite')).send({ username: 'bob' }).expect(201);
    // Alice already has a pending link — a second invite is rejected.
    await csrf(alice.post('/api/household/invite')).send({ username: 'carol' }).expect(400);
    // Bob is already the target of a pending link — inviting him is rejected too.
    const carol = await loginAgent(world.app, 'carol', 'password789');
    await csrf(carol.post('/api/household/invite')).send({ username: 'bob' }).expect(400);
  });

  it('only the recipient may accept or decline', async () => {
    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    await csrf(alice.post(`/api/household/${invite.body.linkId}/accept`)).expect(404);
    await csrf(alice.post(`/api/household/${invite.body.linkId}/decline`)).expect(404);
  });

  it('rejects unlinking a link you are not part of', async () => {
    createUser(world.ctx, 'carol', 'password789');
    const carol = await loginAgent(world.app, 'carol', 'password789');
    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    await csrf(bob.post(`/api/household/${invite.body.linkId}/accept`));

    await csrf(carol.delete(`/api/household/${invite.body.linkId}`)).expect(404);
  });

  it('combines totals across an accepted link, converting currency', async () => {
    await csrf(alice.patch('/api/settings')).send({ currency: 'USD' });
    await csrf(bob.patch('/api/settings')).send({ currency: 'EUR' });
    await csrf(alice.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    await csrf(bob.post('/api/assets')).send({ category: 'cash', name: 'Konto', valueMinor: 500_00 });

    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    await csrf(bob.post(`/api/household/${invite.body.linkId}/accept`));

    const res = await alice.get('/api/household/combined/summary');
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    // Bob's 500 EUR converted to USD is added on top of Alice's own 1000 USD —
    // exact figure depends on the rough static fx table, just assert it grew.
    expect(res.body.assetsMinor).toBeGreaterThan(1_000_00);
  });

  it('respects an excluded holding in the combined totals', async () => {
    const stash = await csrf(alice.post('/api/assets'))
      .send({ category: 'cash', name: 'Excluded', valueMinor: 1_000_00 });
    await csrf(alice.post('/api/assets')).send({ category: 'cash', name: 'Counted', valueMinor: 200_00 });
    await csrf(alice.patch(`/api/assets/${stash.body.id}`)).send({ excludeFromTotals: true });

    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    await csrf(bob.post(`/api/household/${invite.body.linkId}/accept`));

    const res = await alice.get('/api/household/combined/summary');
    expect(res.body.assetsMinor).toBe(200_00);
  });

  it('never exposes holding-level fields in the combined response', async () => {
    await csrf(alice.post('/api/assets')).send({ category: 'cash', name: 'Secret stash', valueMinor: 1_000_00 });
    await csrf(bob.post('/api/assets')).send({ category: 'cash', name: 'My account', valueMinor: 500_00 });
    const invite = await csrf(alice.post('/api/household/invite')).send({ username: 'bob' });
    await csrf(bob.post(`/api/household/${invite.body.linkId}/accept`));

    const summary = await alice.get('/api/household/combined/summary');
    expect(Object.keys(summary.body).sort()).toEqual(['assetsMinor', 'currency', 'liabilitiesMinor', 'netWorthMinor']);
    expect(JSON.stringify(summary.body)).not.toContain('Secret stash');
    expect(JSON.stringify(summary.body)).not.toContain('My account');

    const history = await alice.get('/api/household/combined/history?range=1Y');
    expect(JSON.stringify(history.body)).not.toContain('Secret stash');
    expect(JSON.stringify(history.body)).not.toContain('My account');
  });

  it('rejects combined views without an accepted link', async () => {
    await alice.get('/api/household/combined/summary').expect(400);
  });

  it('requires authentication', async () => {
    await request(world.app).get('/api/household/status').expect(401);
  });
});
