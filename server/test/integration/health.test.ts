import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeTestWorld, type TestWorld } from '../helpers.js';

describe('health', () => {
  let world: TestWorld;
  beforeEach(() => {
    world = makeTestWorld();
  });

  describe('simple liveness — GET /api/health', () => {
    it('returns 200 { ok: true } with no auth', async () => {
      const res = await request(world.app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('detailed readiness — GET /api/health/detailed', () => {
    it('reports ok with up server/database and per-component checks, no auth', async () => {
      const res = await request(world.app).get('/api/health/detailed');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.version).toBe('string');
      expect(res.body.version.length).toBeGreaterThan(0);
      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(typeof res.body.timestamp).toBe('string');

      expect(res.body.checks.server.status).toBe('up');
      expect(res.body.checks.database.status).toBe('up');
      expect(typeof res.body.checks.database.latencyMs).toBe('number');
      // The test world points WEB_DIST_DIR at a nonexistent dir; outside
      // production the frontend is served by Vite, so the UI check is skipped.
      expect(res.body.checks.ui.status).toBe('skipped');
    });

    it('never leaks any financial or account data', async () => {
      const res = await request(world.app).get('/api/health/detailed');
      const serialized = JSON.stringify(res.body).toLowerCase();
      for (const forbidden of ['minor', 'networth', 'net_worth', 'asset', 'liabilit',
        'currenc', 'balance', 'amount', 'snapshot', 'username', 'password']) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('reports the UI as up when the built SPA bundle is present', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-health-'));
      try {
        fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
        world.ctx.config.webDistDir = dir;
        const res = await request(world.app).get('/api/health/detailed');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.checks.ui.status).toBe('up');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('is degraded (but still 200) in production when the UI bundle is missing', async () => {
      const prod = makeTestWorld({ env: 'production' }); // webDistDir = /nonexistent
      const res = await request(prod.app).get('/api/health/detailed');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
      expect(res.body.checks.ui.status).toBe('down');
      expect(res.body.checks.database.status).toBe('up');
    });

    it('returns 503 status:down when the database is unreachable', async () => {
      world.ctx.db.close(); // subsequent queries throw
      const res = await request(world.app).get('/api/health/detailed');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('down');
      expect(res.body.checks.database.status).toBe('down');
      // The raw error (which can contain a file path) is not echoed back.
      expect(res.body.checks.database.detail).toBe('query failed');
    });
  });

  describe('liveness stays cheap', () => {
    it('answers /api/health even when the database is down', async () => {
      world.ctx.db.close();
      const res = await request(world.app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});
