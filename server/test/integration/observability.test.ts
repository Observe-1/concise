import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/lib/logger.js';
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

  it('emits one structured completion log per request, with no financial data', async () => {
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
    // The access log never carries request/response bodies or financial fields.
    expect(entry).not.toHaveProperty('body');
    expect(entry).not.toHaveProperty('netWorthMinor');
  });

  it('tags the completion log with the authenticated user id', async () => {
    const { world, lines } = capturingWorld();
    const userId = createUser(world.ctx, 'alice', 'password123');
    const agent = await loginAgent(world.app, 'alice', 'password123');
    await agent.get('/api/dashboard/summary');
    await tick();

    const entry = lines.find(
      (l) => l.msg === 'request completed' && l.path === '/api/dashboard/summary',
    );
    expect(entry).toBeDefined();
    expect(entry!.userId).toBe(userId);
  });
});
