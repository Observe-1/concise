import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/lib/logger.js';
import { errorHandler } from '../../src/middleware/errors.js';
import { requestLogger } from '../../src/middleware/requestLogger.js';
import { createUser, loginAgent, makeTestWorld } from '../helpers.js';

/** Let the response's 'finish' handler (which emits the log) run. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A world whose logger captures every emitted line as a parsed object. */
function capturingWorld() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(loadConfig({}), {
    write: (s: string) => lines.push(JSON.parse(s)),
  });
  return { world: makeTestWorld({ logger }), lines };
}

describe('observability: request ids + structured logs', () => {
  it('sets a generated x-request-id header on every response', async () => {
    const world = makeTestWorld();
    const res = await request(world.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i); // a UUID
  });

  it('preserves an inbound x-request-id for proxy correlation', async () => {
    const world = makeTestWorld();
    const res = await request(world.app).get('/api/health').set('x-request-id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('rejects an unsafe inbound x-request-id and generates a clean one', async () => {
    const world = makeTestWorld();
    // A value with spaces/control-ish chars must not be reflected verbatim.
    const res = await request(world.app).get('/api/health').set('x-request-id', 'bad id with spaces');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('emits one structured completion log per request with the expected fields', async () => {
    const { world, lines } = capturingWorld();
    const res = await request(world.app).get('/api/health/detailed').set('x-request-id', 'trace-xyz');
    await tick();

    const entry = lines.find((l) => l.msg === 'request completed' && l.requestId === 'trace-xyz');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      method: 'GET',
      path: '/api/health/detailed', // path only — never the query string
      status: res.status,
      requestId: 'trace-xyz',
    });
    expect(typeof entry!.durationMs).toBe('number');
  });

  it('tags the completion log with the user id and logs no financial data, even on a money endpoint', async () => {
    const { world, lines } = capturingWorld();
    const userId = createUser(world.ctx, 'alice', 'password123');
    const agent = await loginAgent(world.app, 'alice', 'password123');
    // /dashboard/summary genuinely returns net worth / assets / liabilities…
    await agent.get('/api/dashboard/summary');
    await tick();

    const entry = lines.find(
      (l) => l.msg === 'request completed' && l.path === '/api/dashboard/summary',
    );
    expect(entry).toBeDefined();
    expect(entry!.userId).toBe(userId);
    // …yet none of those figures (or any request body) reach the access log.
    expect(entry).not.toHaveProperty('body');
    expect(entry).not.toHaveProperty('netWorthMinor');
    expect(entry).not.toHaveProperty('assetsMinor');
    expect(entry).not.toHaveProperty('liabilitiesMinor');
  });

  it('logs unhandled errors through the request logger with the request id', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger(loadConfig({}), { write: (s: string) => lines.push(JSON.parse(s)) });
    const { ctx } = makeTestWorld({ logger });

    // Same middleware wiring as app.ts (requestLogger → route → errorHandler),
    // with a route that throws so the unhandled-error branch runs.
    const app = express();
    app.use('/api', requestLogger(ctx));
    app.get('/api/boom', () => {
      throw new Error('boom');
    });
    app.use(errorHandler);

    const res = await request(app).get('/api/boom').set('x-request-id', 'err-1');
    expect(res.status).toBe(500);
    await tick();

    // The error is logged with the request id (so a 500 is traceable) …
    const errLine = lines.find((l) => l.msg === 'unhandled error' && l.requestId === 'err-1');
    expect(errLine).toBeDefined();
    // … and the access log still records the request as a 500.
    const access = lines.find((l) => l.msg === 'request completed' && l.requestId === 'err-1');
    expect(access?.status).toBe(500);
  });
});
