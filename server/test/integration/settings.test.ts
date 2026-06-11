import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';

describe('settings API', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('returns profile and preferences', async () => {
    const res = await agent.get('/api/settings');
    expect(res.body).toEqual({ username: 'alice', displayName: 'alice', currency: 'USD' });
  });

  it('updates display name and currency', async () => {
    const res = await csrf(agent.patch('/api/settings'))
      .send({ displayName: 'Alice A.', currency: 'gbp' });
    expect(res.body.displayName).toBe('Alice A.');
    expect(res.body.currency).toBe('GBP');

    // currency flows into the session user (used for formatting)
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.currency).toBe('GBP');
  });

  it('validates currency codes', async () => {
    await csrf(agent.patch('/api/settings')).send({ currency: 'POUNDS' }).expect(400);
    await csrf(agent.patch('/api/settings')).send({ currency: '12$' }).expect(400);
  });
});
