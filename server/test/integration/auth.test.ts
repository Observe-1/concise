import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';

describe('auth API', () => {
  let world: TestWorld;
  beforeEach(() => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
  });

  it('logs in with valid credentials and sets an httpOnly cookie', async () => {
    const res = await csrf(request(world.app).post('/api/auth/login'))
      .send({ username: 'alice', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('alice');
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('concise_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('treats usernames case-insensitively', async () => {
    const res = await csrf(request(world.app).post('/api/auth/login'))
      .send({ username: 'ALICE', password: 'password123' });
    expect(res.status).toBe(200);
  });

  it('rejects bad credentials with a generic message', async () => {
    const res = await csrf(request(world.app).post('/api/auth/login'))
      .send({ username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');

    const unknown = await csrf(request(world.app).post('/api/auth/login'))
      .send({ username: 'nobody', password: 'password123' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(res.body.error); // no user enumeration
  });

  it('validates the login payload', async () => {
    const res = await csrf(request(world.app).post('/api/auth/login')).send({ username: 'alice' });
    expect(res.status).toBe(400);
  });

  it('returns the session user from /me and 401 when logged out', async () => {
    const agent = await loginAgent(world.app);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('alice');

    await csrf(agent.post('/api/auth/logout')).expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('expires sessions after the TTL', async () => {
    const agent = await loginAgent(world.app);
    world.advanceDays(15); // TTL is 14 days
    await agent.get('/api/auth/me').expect(401);
  });

  it('audit-logs successful and failed logins', async () => {
    await csrf(request(world.app).post('/api/auth/login'))
      .send({ username: 'alice', password: 'password123' });
    await csrf(request(world.app).post('/api/auth/login'))
      .send({ username: 'alice', password: 'nope' });
    const actions = (world.ctx.db.prepare('SELECT action FROM audit_log ORDER BY id').all() as
      { action: string }[]).map((r) => r.action);
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login_failed');
  });

  describe('registration', () => {
    it('creates an account and logs it straight in', async () => {
      const agent = request.agent(world.app);
      const res = await csrf(agent.post('/api/auth/register'))
        .send({ username: 'Newbie', password: 'longenough1', displayName: 'New B.' });
      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe('newbie'); // lowercased
      expect(res.body.user.displayName).toBe('New B.');
      expect(res.headers['set-cookie']?.[0]).toContain('concise_session=');

      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.username).toBe('newbie');

      // settings row created with defaults
      const settings = await agent.get('/api/settings');
      expect(settings.body.currency).toBe('USD');
    });

    it('rejects taken usernames case-insensitively with 409', async () => {
      const res = await csrf(request(world.app).post('/api/auth/register'))
        .send({ username: 'ALICE', password: 'longenough1' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already taken/i);
    });

    it('validates username and password rules', async () => {
      const post = (body: object) =>
        csrf(request(world.app).post('/api/auth/register')).send(body);
      await post({ username: 'ab', password: 'longenough1' }).expect(400); // too short
      await post({ username: 'has spaces', password: 'longenough1' }).expect(400);
      await post({ username: 'fine.name', password: 'short' }).expect(400); // weak password
    });

    it('audit-logs registrations', async () => {
      await csrf(request(world.app).post('/api/auth/register'))
        .send({ username: 'audited', password: 'longenough1' });
      const actions = (world.ctx.db.prepare('SELECT action FROM audit_log').all() as
        { action: string }[]).map((r) => r.action);
      expect(actions).toContain('auth.register');
    });
  });

  it('rate-limits repeated login attempts', async () => {
    const limited = makeTestWorld({ env: 'development' }); // real limits
    createUser(limited.ctx, 'bob', 'hunter22222');
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await csrf(request(limited.app).post('/api/auth/login'))
        .send({ username: 'bob', password: 'wrong' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
