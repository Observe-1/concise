import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { addDays, daysBetween } from '../../src/lib/dates.js';

// Mirrors goals/service.ts's suggestedMonthlyMinor formula exactly, so tests
// assert against a computed value rather than a hand-derived constant.
const DAYS_PER_MONTH = 365.25 / 12;
function expectedSuggestion(remainingMinor: number, fromISO: string, toISO: string): number {
  return Math.ceil(remainingMinor / (daysBetween(fromISO, toISO) / DAYS_PER_MONTH));
}

describe('goals', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('leaves an excluded asset out of a net-worth goal\'s progress', async () => {
    const excluded = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Excluded', valueMinor: 1_000_00 });
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Counted', valueMinor: 200_00 });
    await csrf(agent.patch(`/api/assets/${excluded.body.id}`)).send({ excludeFromTotals: true });

    const goal = await csrf(agent.post('/api/goals')).send({ name: 'Grow', targetMinor: 1_000_00 });
    expect(goal.body.currentMinor).toBe(200_00);
  });

  it('creates, lists, patches and deletes goals', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });

    const created = await csrf(agent.post('/api/goals')).send({
      name: 'Emergency fund', targetMinor: 5_000_00, targetDate: '2027-01-01', notes: 'Six months of expenses',
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Emergency fund');
    expect(created.body.currentMinor).toBe(1_000_00);
    expect(created.body.progressPct).toBe(20);

    const list = await agent.get('/api/goals');
    expect(list.body).toHaveLength(1);

    const patched = await csrf(agent.patch(`/api/goals/${created.body.id}`)).send({ targetMinor: 2_000_00 });
    expect(patched.body.targetMinor).toBe(2_000_00);
    expect(patched.body.progressPct).toBe(50);

    await csrf(agent.delete(`/api/goals/${created.body.id}`)).expect(204);
    expect((await agent.get('/api/goals')).body).toHaveLength(0);
  });

  it('defaults showOnPrediction to true and toggles it via patch', async () => {
    const created = await csrf(agent.post('/api/goals')).send({ name: 'Grow', targetMinor: 1_000_00 });
    expect(created.body.showOnPrediction).toBe(true);

    const off = await csrf(agent.patch(`/api/goals/${created.body.id}`)).send({ showOnPrediction: false });
    expect(off.body.showOnPrediction).toBe(false);

    // Patching unrelated fields leaves the flag untouched.
    const renamed = await csrf(agent.patch(`/api/goals/${created.body.id}`)).send({ name: 'Renamed' });
    expect(renamed.body.showOnPrediction).toBe(false);
  });

  it('honours showOnPrediction:false at creation', async () => {
    const created = await csrf(agent.post('/api/goals'))
      .send({ name: 'Hidden', targetMinor: 1_000_00, showOnPrediction: false });
    expect(created.body.showOnPrediction).toBe(false);
  });

  it('scopes goals to their owner', async () => {
    const created = await csrf(agent.post('/api/goals')).send({ name: 'Mine', targetMinor: 1_000_00 });

    createUser(world.ctx, 'mallory', 'password456');
    const mallory = await loginAgent(world.app, 'mallory', 'password456');
    await csrf(mallory.patch(`/api/goals/${created.body.id}`)).send({ name: 'Stolen' }).expect(404);
    await csrf(mallory.delete(`/api/goals/${created.body.id}`)).expect(404);
  });

  it('validates payloads', async () => {
    await csrf(agent.post('/api/goals')).send({ name: '', targetMinor: 1_000_00 }).expect(400);
    await csrf(agent.post('/api/goals')).send({ name: 'X', targetMinor: 0 }).expect(400);
    await csrf(agent.post('/api/goals')).send({ name: 'X', targetMinor: -100 }).expect(400);
    await csrf(agent.post('/api/goals')).send({ name: 'X', targetMinor: 100, targetDate: 'soon' }).expect(400);
  });

  it('computes a rough linear-trend ETA from snapshot history', async () => {
    const asset = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    const dayZero = '2026-06-11';

    world.advanceDays(30);
    agent = await loginAgent(world.app); // session TTL (14d default) is shorter than the 30-day jump
    await csrf(agent.post(`/api/assets/${asset.body.id}/valuations`)).send({ valueMinor: 1_300_00 });
    const dayThirty = addDays(dayZero, 30);

    const goal = await csrf(agent.post('/api/goals')).send({ name: 'Grow', targetMinor: 2_000_00 });
    expect(goal.body.currentMinor).toBe(1_300_00);
    // dailyRate = (1_300_00 - 1_000_00) / 30 = 1000 minor units/day;
    // daysNeeded = (2_000_00 - 1_300_00) / 1000 = 70 days.
    expect(goal.body.etaISO).toBe(addDays(dayThirty, 70));
  });

  it('reports no ETA when net worth is flat or shrinking', async () => {
    const asset = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });

    world.advanceDays(30);
    agent = await loginAgent(world.app);
    await csrf(agent.post(`/api/assets/${asset.body.id}/valuations`)).send({ valueMinor: 800_00 });

    const goal = await csrf(agent.post('/api/goals')).send({ name: 'Grow', targetMinor: 2_000_00 });
    expect(goal.body.etaISO).toBeNull();
  });

  it('reports today as the ETA when the target is already met', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 5_000_00 });

    const goal = await csrf(agent.post('/api/goals')).send({ name: 'Already there', targetMinor: 1_000_00 });
    expect(goal.body.etaISO).toBe('2026-06-11');
    expect(goal.body.progressPct).toBe(500);
  });

  it('suggests a monthly contribution toward a future target date', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    const today = '2026-06-11';
    const targetDate = '2027-06-11';

    const goal = await csrf(agent.post('/api/goals'))
      .send({ name: 'Grow', targetMinor: 5_000_00, targetDate });
    expect(goal.body.suggestedMonthlyMinor).toBe(expectedSuggestion(4_000_00, today, targetDate));
  });

  it('suggests no monthly contribution without a target date', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    const goal = await csrf(agent.post('/api/goals')).send({ name: 'Grow', targetMinor: 5_000_00 });
    expect(goal.body.suggestedMonthlyMinor).toBeNull();
  });

  it('suggests no monthly contribution once the target is already met', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 5_000_00 });
    const goal = await csrf(agent.post('/api/goals'))
      .send({ name: 'Already there', targetMinor: 1_000_00, targetDate: '2027-06-11' });
    expect(goal.body.suggestedMonthlyMinor).toBeNull();
  });

  it('suggests no monthly contribution when the target date is in the past', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    const goal = await csrf(agent.post('/api/goals'))
      .send({ name: 'Grow', targetMinor: 5_000_00, targetDate: '2026-01-01' });
    expect(goal.body.suggestedMonthlyMinor).toBeNull();
  });
});

describe('liability payoff goals', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('captures the liability balance as a baseline at creation', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });

    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id,
    });
    expect(goal.status).toBe(201);
    expect(goal.body).toMatchObject({
      goalType: 'liability_payoff', targetMinor: 0, liabilityId: loan.body.id, liabilityName: 'Car loan',
      baselineMinor: 10_000_00, currentMinor: 10_000_00, progressPct: 0,
    });
  });

  it('computes progress and ETA as the balance is paid down', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });
    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id,
    });
    const dayZero = '2026-06-11';

    world.advanceDays(30);
    agent = await loginAgent(world.app);
    await csrf(agent.post(`/api/liabilities/${loan.body.id}/valuations`)).send({ valueMinor: 9_400_00 });
    const dayThirty = addDays(dayZero, 30);

    const updated = await agent.get(`/api/goals/${goal.body.id}`);
    expect(updated.body.currentMinor).toBe(9_400_00);
    expect(updated.body.progressPct).toBe(6); // (10000-9400)/10000 * 100
    // dailyRate = (9400-10000)/30 = -20/day; daysNeeded = 9400/20 = 470 days.
    expect(updated.body.etaISO).toBe(addDays(dayThirty, 470));
  });

  it('reports no ETA when the balance is flat or growing', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });
    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id,
    });

    world.advanceDays(30);
    agent = await loginAgent(world.app);
    await csrf(agent.post(`/api/liabilities/${loan.body.id}/valuations`)).send({ valueMinor: 10_500_00 });

    const updated = await agent.get(`/api/goals/${goal.body.id}`);
    expect(updated.body.etaISO).toBeNull();
  });

  it('reports today and 100% progress once the liability is fully paid off', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });
    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id,
    });
    await csrf(agent.post(`/api/liabilities/${loan.body.id}/valuations`)).send({ valueMinor: 0 });

    const updated = await agent.get(`/api/goals/${goal.body.id}`);
    expect(updated.body.etaISO).toBe('2026-06-11');
    expect(updated.body.progressPct).toBe(100);
  });

  it('rejects a payoff goal targeting another user\'s liability', async () => {
    createUser(world.ctx, 'mallory', 'password456');
    const mallory = await loginAgent(world.app, 'mallory', 'password456');
    const loan = await csrf(mallory.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Mallory loan', valueMinor: 5_000_00 });

    await csrf(agent.post('/api/goals')).send({
      name: 'Steal payoff', goalType: 'liability_payoff', liabilityId: loan.body.id,
    }).expect(404);
  });

  it('validates the goalType/targetMinor/liabilityId combination', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });
    // payoff goal without a liabilityId
    await csrf(agent.post('/api/goals')).send({ name: 'X', goalType: 'liability_payoff' }).expect(400);
    // payoff goal with both targetMinor and liabilityId
    await csrf(agent.post('/api/goals')).send({
      name: 'X', goalType: 'liability_payoff', liabilityId: loan.body.id, targetMinor: 100,
    }).expect(400);
  });

  it('ignores a targetMinor patch on a payoff goal (target stays 0)', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });
    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id,
    });
    const patched = await csrf(agent.patch(`/api/goals/${goal.body.id}`)).send({ name: 'Renamed', targetMinor: 999 });
    expect(patched.body.name).toBe('Renamed');
    expect(patched.body.targetMinor).toBe(0);
  });

  it('deletes the goal when its liability is deleted (cascade)', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });
    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id,
    });

    await csrf(agent.delete(`/api/liabilities/${loan.body.id}`)).expect(204);
    await agent.get(`/api/goals/${goal.body.id}`).expect(404);
  });

  it('suggests a monthly extra payment toward a future target date', async () => {
    const today = '2026-06-11';
    const targetDate = '2027-06-11';
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });

    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id, targetDate,
    });
    expect(goal.body.suggestedMonthlyMinor).toBe(expectedSuggestion(10_000_00, today, targetDate));
  });

  it('suggests no extra payment once the liability is fully paid off', async () => {
    const loan = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Car loan', valueMinor: 10_000_00 });
    const goal = await csrf(agent.post('/api/goals')).send({
      name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: loan.body.id, targetDate: '2027-06-11',
    });
    await csrf(agent.post(`/api/liabilities/${loan.body.id}/valuations`)).send({ valueMinor: 0 });

    const updated = await agent.get(`/api/goals/${goal.body.id}`);
    expect(updated.body.suggestedMonthlyMinor).toBeNull();
  });
});
