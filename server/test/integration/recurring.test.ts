import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { runDueRecurring } from '../../src/modules/recurring/service.js';

describe('recurring transactions', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;
  let userId: number;
  let savingsId: number;
  let loanId: number;

  beforeEach(async () => {
    world = makeTestWorld();
    userId = createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
    savingsId = (await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 })).body.id;
    loanId = (await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Loan', valueMinor: 500_00 })).body.id;
  });

  it('creates, lists, updates and deletes schedules', async () => {
    const created = await csrf(agent.post('/api/recurring')).send({
      name: 'Save monthly', targetType: 'asset', targetId: savingsId,
      amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-07-01',
    });
    expect(created.status).toBe(201);
    expect(created.body.targetName).toBe('Savings');

    const list = await agent.get('/api/recurring');
    expect(list.body).toHaveLength(1);

    const patched = await csrf(agent.patch(`/api/recurring/${created.body.id}`))
      .send({ active: false, amountMinor: 150_00 });
    expect(patched.body.active).toBe(false);
    expect(patched.body.amountMinor).toBe(150_00);

    await csrf(agent.delete(`/api/recurring/${created.body.id}`)).expect(204);
    expect((await agent.get('/api/recurring')).body).toHaveLength(0);
  });

  it('rejects schedules targeting other users entries', async () => {
    createUser(world.ctx, 'mallory', 'password456');
    const mallory = await loginAgent(world.app, 'mallory', 'password456');
    const res = await csrf(mallory.post('/api/recurring')).send({
      name: 'Drain', targetType: 'asset', targetId: savingsId,
      amountMinor: -100_00, cadence: 'monthly', nextRunOn: '2026-07-01',
    });
    expect(res.status).toBe(400);
  });

  it('validates payloads', async () => {
    const base = {
      name: 'X', targetType: 'asset', targetId: savingsId,
      amountMinor: 100, cadence: 'monthly', nextRunOn: '2026-07-01',
    };
    await csrf(agent.post('/api/recurring')).send({ ...base, amountMinor: 0 }).expect(400);
    await csrf(agent.post('/api/recurring')).send({ ...base, cadence: 'hourly' }).expect(400);
    await csrf(agent.post('/api/recurring')).send({ ...base, nextRunOn: 'tomorrow' }).expect(400);
    await csrf(agent.post('/api/recurring')).send({ ...base, targetId: 99999 }).expect(400);
  });

  it('applies due occurrences and advances the cursor', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Save', targetType: 'asset', targetId: savingsId,
      amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-06-11',
    });
    const applied = runDueRecurring(world.ctx);
    expect(applied).toBe(1);

    const asset = await agent.get(`/api/assets/${savingsId}`);
    expect(asset.body.currentValueMinor).toBe(1_100_00);

    const schedule = (await agent.get('/api/recurring')).body[0];
    expect(schedule.nextRunOn).toBe('2026-07-11');
    expect(schedule.lastRunOn).toBe('2026-06-11');

    // Running again the same day is a no-op (cursor moved forward).
    expect(runDueRecurring(world.ctx)).toBe(0);
  });

  it('supports a quarterly cadence', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Quarterly bonus', targetType: 'asset', targetId: savingsId,
      amountMinor: 250_00, cadence: 'quarterly', nextRunOn: '2026-06-11',
    });
    expect(runDueRecurring(world.ctx)).toBe(1);

    const asset = await agent.get(`/api/assets/${savingsId}`);
    expect(asset.body.currentValueMinor).toBe(1_250_00);

    const schedule = (await agent.get('/api/recurring')).body[0];
    expect(schedule.cadence).toBe('quarterly');
    expect(schedule.nextRunOn).toBe('2026-09-11'); // three months on
  });

  it('applies percentage schedules to the targets current value', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Interest', targetType: 'asset', targetId: savingsId,
      percent: 10, cadence: 'monthly', nextRunOn: '2026-06-11',
    });
    expect(runDueRecurring(world.ctx)).toBe(1);

    const asset = await agent.get(`/api/assets/${savingsId}`);
    expect(asset.body.currentValueMinor).toBe(1_100_00); // 1000 × 1.10

    const schedule = (await agent.get('/api/recurring')).body[0];
    expect(schedule.amountType).toBe('percent');
    expect(schedule.percent).toBe(10);
    expect(schedule.amountMinor).toBeNull();
  });

  it('percentage schedules compound across catch-up occurrences', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Halve the loan', targetType: 'liability', targetId: loanId,
      percent: -50, cadence: 'monthly', nextRunOn: '2026-06-11',
    });
    world.advanceDays(35); // Jun 11 + Jul 11 due
    expect(runDueRecurring(world.ctx)).toBe(2);

    agent = await loginAgent(world.app); // previous session expired with the clock jump
    const loan = await agent.get(`/api/liabilities/${loanId}`);
    expect(loan.body.currentValueMinor).toBe(125_00); // 500 → 250 → 125
  });

  it('requires exactly one of amount and percent', async () => {
    const base = {
      name: 'X', targetType: 'asset', targetId: savingsId,
      cadence: 'monthly', nextRunOn: '2026-07-01',
    };
    await csrf(agent.post('/api/recurring')).send(base).expect(400); // neither
    await csrf(agent.post('/api/recurring'))
      .send({ ...base, amountMinor: 100, percent: 5 }).expect(400); // both
    await csrf(agent.post('/api/recurring')).send({ ...base, percent: 0 }).expect(400);
    await csrf(agent.post('/api/recurring')).send({ ...base, percent: -150 }).expect(400);

    // switching an existing fixed schedule to percent via PATCH
    const created = await csrf(agent.post('/api/recurring'))
      .send({ ...base, amountMinor: 100_00 });
    const patched = await csrf(agent.patch(`/api/recurring/${created.body.id}`))
      .send({ percent: 2.5 });
    expect(patched.body.amountType).toBe('percent');
    expect(patched.body.percent).toBe(2.5);
    expect(patched.body.amountMinor).toBeNull();
  });

  it('catches up missed occurrences after downtime', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Pay loan', targetType: 'liability', targetId: loanId,
      amountMinor: -100_00, cadence: 'monthly', nextRunOn: '2026-06-15',
    });
    world.advanceDays(80); // ~2026-08-30: 3 occurrences due (Jun 15, Jul 15, Aug 15)
    const applied = runDueRecurring(world.ctx);
    expect(applied).toBe(3);

    agent = await loginAgent(world.app); // previous session expired with the clock jump
    const loan = await agent.get(`/api/liabilities/${loanId}`);
    expect(loan.body.currentValueMinor).toBe(200_00);
    const schedule = (await agent.get('/api/recurring')).body[0];
    expect(schedule.nextRunOn).toBe('2026-09-15');
  });

  it('floors balances at zero and pays off the loan (suspends the schedule)', async () => {
    const created = await csrf(agent.post('/api/recurring')).send({
      name: 'Overpay', targetType: 'liability', targetId: loanId,
      amountMinor: -400_00, cadence: 'monthly', nextRunOn: '2026-06-11',
    });
    world.advanceDays(40);
    runDueRecurring(world.ctx);
    agent = await loginAgent(world.app); // previous session expired with the clock jump
    const loan = await agent.get(`/api/liabilities/${loanId}`);
    expect(loan.body.currentValueMinor).toBe(0); // 500 - 400 → 100, 100 - 400 → paid off

    // Paid off: the schedule is suspended, so a later run never overshoots.
    const schedule = (await agent.get('/api/recurring')).body
      .find((r: { id: number }) => r.id === created.body.id);
    expect(schedule.active).toBe(false);
    world.advanceDays(40);
    expect(runDueRecurring(world.ctx)).toBe(0);
  });

  it('paying off a liability suspends all of its schedules', async () => {
    // A payment schedule and an interest schedule on the same loan.
    await csrf(agent.post('/api/recurring')).send({
      name: 'Overpay', targetType: 'liability', targetId: loanId,
      amountMinor: -300_00, cadence: 'monthly', nextRunOn: '2026-06-11',
    });
    await csrf(agent.post('/api/recurring')).send({
      name: 'Interest', targetType: 'liability', targetId: loanId,
      percent: 1, cadence: 'monthly', nextRunOn: '2026-07-11',
    });
    world.advanceDays(40); // 500 → 200 (Jun 11), 200 - 300 → paid off (Jul 11)
    runDueRecurring(world.ctx);

    agent = await loginAgent(world.app);
    const loan = await agent.get(`/api/liabilities/${loanId}`);
    expect(loan.body.currentValueMinor).toBe(0);

    const schedules = (await agent.get('/api/recurring')).body as { active: boolean }[];
    expect(schedules).toHaveLength(2);
    expect(schedules.every((s) => s.active === false)).toBe(true);
  });

  it('ignores inactive schedules', async () => {
    const created = await csrf(agent.post('/api/recurring')).send({
      name: 'Paused', targetType: 'asset', targetId: savingsId,
      amountMinor: 100_00, cadence: 'daily', nextRunOn: '2026-06-11',
    });
    await csrf(agent.patch(`/api/recurring/${created.body.id}`)).send({ active: false });
    expect(runDueRecurring(world.ctx)).toBe(0);
  });

  it('recomputes snapshots for the catch-up window', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Save daily', targetType: 'asset', targetId: savingsId,
      amountMinor: 10_00, cadence: 'daily', nextRunOn: '2026-06-12',
    });
    world.advanceDays(3); // Jun 12, 13, 14 due
    runDueRecurring(world.ctx);
    const snaps = world.ctx.db
      .prepare('SELECT snapshot_date, assets_minor FROM snapshots WHERE user_id = ? ORDER BY snapshot_date')
      .all(userId) as { snapshot_date: string; assets_minor: number }[];
    const byDate = Object.fromEntries(snaps.map((s) => [s.snapshot_date, s.assets_minor]));
    expect(byDate['2026-06-12']).toBe(1_010_00);
    expect(byDate['2026-06-13']).toBe(1_020_00);
    expect(byDate['2026-06-14']).toBe(1_030_00);
  });
});
