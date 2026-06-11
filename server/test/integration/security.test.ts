import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createUser, csrf, loginAgent, makeTestWorld, TEST_HOST, type TestWorld } from '../helpers.js';

describe('security', () => {
  let world: TestWorld;
  beforeEach(() => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
  });

  describe('CSRF origin checks', () => {
    it('rejects mutating requests without an Origin header', async () => {
      const agent = await loginAgent(world.app);
      const res = await agent.post('/api/assets')
        .send({ category: 'cash', name: 'X', valueMinor: 1 });
      expect(res.status).toBe(403);
    });

    it('rejects cross-origin mutating requests', async () => {
      const agent = await loginAgent(world.app);
      const res = await agent.post('/api/assets')
        .set('Host', TEST_HOST)
        .set('Origin', 'https://evil.example')
        .send({ category: 'cash', name: 'X', valueMinor: 1 });
      expect(res.status).toBe(403);
    });

    it('allows same-origin GETs without Origin', async () => {
      const agent = await loginAgent(world.app);
      await agent.get('/api/assets').expect(200);
    });
  });

  describe('injection resistance', () => {
    it('treats SQL metacharacters in login as plain data', async () => {
      const res = await csrf(request(world.app).post('/api/auth/login'))
        .send({ username: "' OR '1'='1' --", password: "' OR '1'='1' --" });
      expect(res.status).toBe(401);
      // table still intact
      const users = world.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
      expect(users.n).toBe(1);
    });

    it('stores hostile strings safely in entries', async () => {
      const agent = await loginAgent(world.app);
      const hostile = `Robert'); DROP TABLE assets;--<script>alert(1)</script>`;
      const created = await csrf(agent.post('/api/assets'))
        .send({ category: 'other', name: hostile, valueMinor: 1 });
      expect(created.status).toBe(201);
      const fetched = await agent.get(`/api/assets/${created.body.id}`);
      expect(fetched.body.name).toBe(hostile); // stored verbatim, not executed
      expect(world.ctx.db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 });
    });
  });

  describe('authentication boundaries', () => {
    it('rejects all protected endpoints when anonymous', async () => {
      for (const path of ['/api/assets', '/api/liabilities', '/api/recurring',
        '/api/dashboard/summary', '/api/dashboard/history', '/api/settings']) {
        await request(world.app).get(path).expect(401);
      }
      await csrf(request(world.app).post('/api/market/refresh')).expect(401);
    });

    it('rejects forged session cookies', async () => {
      await request(world.app)
        .get('/api/auth/me')
        .set('Cookie', 'concise_session=forged-token-aaaaaaaaaaaaaaaaaaaaaa')
        .expect(401);
    });

    it('invalidates the session server-side on logout', async () => {
      const agent = await loginAgent(world.app);
      await csrf(agent.post('/api/auth/logout')).expect(204);
      await agent.get('/api/assets').expect(401); // cookie may linger; session is gone
    });
  });

  describe('hardening headers', () => {
    it('sets security headers and hides the stack', async () => {
      const res = await request(world.app).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('returns JSON 404 for unknown API routes without leaking internals', async () => {
      const res = await request(world.app).get('/api/definitely-not-here');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    it('rejects oversized JSON bodies', async () => {
      const agent = await loginAgent(world.app);
      const res = await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'X', valueMinor: 1, notes: 'a'.repeat(200_000) });
      expect(res.status).toBe(413);
    });
  });
});
