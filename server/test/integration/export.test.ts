import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';

describe('CSV export', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('streams a CSV with the right headers and rows', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    await csrf(agent.post('/api/liabilities')).send({ category: 'loan', name: 'Loan', valueMinor: 500_00 });

    const res = await agent.get('/api/export/valuations.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="concise-export-.*\.csv"/);

    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('Holding,Kind,Category,Date,Value,Currency');
    expect(lines).toHaveLength(3);
    expect(lines).toContainEqual(expect.stringContaining('Savings,asset,cash,2026-06-11,1000.00,USD'));
    expect(lines).toContainEqual(expect.stringContaining('Loan,liability,loan,2026-06-11,500.00,USD'));
  });

  it('returns a header-only CSV for an empty portfolio', async () => {
    const res = await agent.get('/api/export/valuations.csv');
    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe('Holding,Kind,Category,Date,Value,Currency');
  });

  it('neutralises spreadsheet formula injection in holding names', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'other', name: '=1+1', valueMinor: 100_00 });

    const res = await agent.get('/api/export/valuations.csv');
    expect(res.text).toContain("'=1+1,asset,other");
  });

  it('requires authentication', async () => {
    await request(world.app).get('/api/export/valuations.csv').expect(401);
  });
});
