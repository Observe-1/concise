import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { runDueRecurring } from '../../src/modules/recurring/service.js';
import { convertMinor } from '../../src/lib/fx.js';

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
    const applied = await runDueRecurring(world.ctx);
    expect(applied).toBe(1);

    const asset = await agent.get(`/api/assets/${savingsId}`);
    expect(asset.body.currentValueMinor).toBe(1_100_00);

    const schedule = (await agent.get('/api/recurring')).body[0];
    expect(schedule.nextRunOn).toBe('2026-07-11');
    expect(schedule.lastRunOn).toBe('2026-06-11');

    // Running again the same day is a no-op (cursor moved forward).
    expect(await runDueRecurring(world.ctx)).toBe(0);
  });

  it('supports a quarterly cadence', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Quarterly bonus', targetType: 'asset', targetId: savingsId,
      amountMinor: 250_00, cadence: 'quarterly', nextRunOn: '2026-06-11',
    });
    expect(await runDueRecurring(world.ctx)).toBe(1);

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
    expect(await runDueRecurring(world.ctx)).toBe(1);

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
    expect(await runDueRecurring(world.ctx)).toBe(2);

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
    const applied = await runDueRecurring(world.ctx);
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
    await runDueRecurring(world.ctx);
    agent = await loginAgent(world.app); // previous session expired with the clock jump
    const loan = await agent.get(`/api/liabilities/${loanId}`);
    expect(loan.body.currentValueMinor).toBe(0); // 500 - 400 → 100, 100 - 400 → paid off

    // Paid off: the schedule is suspended, so a later run never overshoots.
    const schedule = (await agent.get('/api/recurring')).body
      .find((r: { id: number }) => r.id === created.body.id);
    expect(schedule.active).toBe(false);
    world.advanceDays(40);
    expect(await runDueRecurring(world.ctx)).toBe(0);
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
    await runDueRecurring(world.ctx);

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
    expect(await runDueRecurring(world.ctx)).toBe(0);
  });

  describe('end date', () => {
    it('applies the occurrence landing on the end date, then stops and deactivates', async () => {
      const created = await csrf(agent.post('/api/recurring')).send({
        name: 'Promo interest', targetType: 'asset', targetId: savingsId,
        amountMinor: 10_00, cadence: 'daily', nextRunOn: '2026-06-12', endDate: '2026-06-13',
      });
      world.advanceDays(4); // today is 2026-06-15; Jun 12, 13, 14, 15 would otherwise be due
      const applied = await runDueRecurring(world.ctx);
      expect(applied).toBe(2); // Jun 12 and Jun 13 (inclusive of the end date) — not Jun 14/15

      agent = await loginAgent(world.app); // previous session expired with the clock jump
      const asset = await agent.get(`/api/assets/${savingsId}`);
      expect(asset.body.currentValueMinor).toBe(1_020_00); // 1000 + 10 + 10

      const schedule = (await agent.get('/api/recurring')).body
        .find((r: { id: number }) => r.id === created.body.id);
      expect(schedule.active).toBe(false);

      // Confirmed stopped for good — running again applies nothing further.
      world.advanceDays(10);
      expect(await runDueRecurring(world.ctx)).toBe(0);
    });

    it('a schedule with no end date keeps running past where one would have stopped it', async () => {
      await csrf(agent.post('/api/recurring')).send({
        name: 'Ongoing interest', targetType: 'asset', targetId: savingsId,
        amountMinor: 10_00, cadence: 'daily', nextRunOn: '2026-06-12',
      });
      world.advanceDays(4);
      expect(await runDueRecurring(world.ctx)).toBe(4); // Jun 12-15, all applied — nothing stops it
    });

    it('rejects an end date before the next run date on create', async () => {
      await csrf(agent.post('/api/recurring')).send({
        name: 'X', targetType: 'asset', targetId: savingsId,
        amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-07-01', endDate: '2026-06-01',
      }).expect(400);
    });

    it('rejects an end-date/next-run combination on update that would cross over', async () => {
      const created = await csrf(agent.post('/api/recurring')).send({
        name: 'X', targetType: 'asset', targetId: savingsId,
        amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-07-01', endDate: '2026-12-01',
      });
      // Patching the end date before the existing next-run date.
      await csrf(agent.patch(`/api/recurring/${created.body.id}`))
        .send({ endDate: '2026-06-01' }).expect(400);
      // Patching the next-run date past the existing end date.
      await csrf(agent.patch(`/api/recurring/${created.body.id}`))
        .send({ nextRunOn: '2027-01-01' }).expect(400);
    });

    it('lets an end date be cleared back to running forever', async () => {
      const created = await csrf(agent.post('/api/recurring')).send({
        name: 'X', targetType: 'asset', targetId: savingsId,
        amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-07-01', endDate: '2026-12-01',
      });
      expect(created.body.endDate).toBe('2026-12-01');
      const patched = await csrf(agent.patch(`/api/recurring/${created.body.id}`)).send({ endDate: null });
      expect(patched.body.endDate).toBeNull();
    });

    it('the prediction graph stops compounding past the end date too', async () => {
      // One monthly +10% occurrence (Jul 11), then the schedule ends — the
      // graph must plateau afterward, matching what the live engine would do.
      await csrf(agent.post('/api/recurring')).send({
        name: 'Promo interest', targetType: 'asset', targetId: savingsId,
        percent: 10, cadence: 'monthly', nextRunOn: '2026-07-11', endDate: '2026-07-11',
      });
      const pred = await agent.get('/api/dashboard/prediction?range=1Y');
      const points = pred.body.points as { date: string; assetsMinor: number }[];
      const afterBump = points.filter((p) => p.date >= '2026-07-11');
      expect(afterBump.length).toBeGreaterThan(1);
      // Every point from the one occurrence onward holds at 1000 × 1.10 —
      // it never compounds a second time.
      expect(afterBump.every((p) => p.assetsMinor === 1_100_00)).toBe(true);
    });
  });

  it('recomputes snapshots for the catch-up window', async () => {
    await csrf(agent.post('/api/recurring')).send({
      name: 'Save daily', targetType: 'asset', targetId: savingsId,
      amountMinor: 10_00, cadence: 'daily', nextRunOn: '2026-06-12',
    });
    world.advanceDays(3); // Jun 12, 13, 14 due
    await runDueRecurring(world.ctx);
    const snaps = world.ctx.db
      .prepare('SELECT snapshot_date, assets_minor FROM snapshots WHERE user_id = ? ORDER BY snapshot_date')
      .all(userId) as { snapshot_date: string; assets_minor: number }[];
    const byDate = Object.fromEntries(snaps.map((s) => [s.snapshot_date, s.assets_minor]));
    expect(byDate['2026-06-12']).toBe(1_010_00);
    expect(byDate['2026-06-13']).toBe(1_020_00);
    expect(byDate['2026-06-14']).toBe(1_030_00);
  });

  describe('market-mode targets', () => {
    it('buys shares with a fixed amount at the occurrence date\'s price', async () => {
      const asset = await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'BTC', quantity: 0.5,
      });
      await csrf(agent.post('/api/recurring')).send({
        name: 'DCA into BTC', targetType: 'asset', targetId: asset.body.id,
        amountMinor: 400_00, cadence: 'monthly', nextRunOn: '2026-06-11',
      });
      expect(await runDueRecurring(world.ctx)).toBe(1);

      const price = world.ctx.prices.getPriceMinor('BTC', '2026-06-11')!;
      const expectedQuantity = 0.5 + 400_00 / price;
      const updated = await agent.get(`/api/assets/${asset.body.id}`);
      expect(updated.body.quantity).toBeCloseTo(expectedQuantity, 6);
      expect(updated.body.currentValueMinor).toBe(Math.round(price * expectedQuantity));
    });

    it('grows the share count directly for a percent schedule, regardless of price', async () => {
      const asset = await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'BTC', quantity: 0.5,
      });
      await csrf(agent.post('/api/recurring')).send({
        name: 'Grow BTC', targetType: 'asset', targetId: asset.body.id,
        percent: 10, cadence: 'monthly', nextRunOn: '2026-06-11',
      });
      expect(await runDueRecurring(world.ctx)).toBe(1);

      const updated = await agent.get(`/api/assets/${asset.body.id}`);
      expect(updated.body.quantity).toBeCloseTo(0.55, 6); // 0.5 × 1.10
    });

    it('sells shares for a negative fixed amount', async () => {
      const asset = await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'BTC', quantity: 0.5,
      });
      await csrf(agent.post('/api/recurring')).send({
        name: 'Sell BTC', targetType: 'asset', targetId: asset.body.id,
        amountMinor: -100_00, cadence: 'monthly', nextRunOn: '2026-06-11',
      });
      expect(await runDueRecurring(world.ctx)).toBe(1);

      const price = world.ctx.prices.getPriceMinor('BTC', '2026-06-11')!;
      const expectedQuantity = 0.5 - 100_00 / price;
      const updated = await agent.get(`/api/assets/${asset.body.id}`);
      expect(updated.body.quantity).toBeCloseTo(expectedQuantity, 6);
    });

    it('selling everything closes the position out to a manual $0 asset and stops the schedule', async () => {
      // Market-mode requires quantity > 0 at the DB level, so a full sell-off
      // can't just store quantity 0 — closing out to manual is the correct
      // representation anyway: there's no position left to hold.
      const asset = await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'BTC', quantity: 0.1,
      });
      const created = await csrf(agent.post('/api/recurring')).send({
        name: 'Oversell BTC', targetType: 'asset', targetId: asset.body.id,
        amountMinor: -999_999_00, cadence: 'monthly', nextRunOn: '2026-06-11',
      });
      expect(await runDueRecurring(world.ctx)).toBe(1);

      const updated = await agent.get(`/api/assets/${asset.body.id}`);
      expect(updated.body.valuationMode).toBe('manual');
      expect(updated.body.marketSymbol).toBeNull();
      expect(updated.body.quantity).toBeNull();
      expect(updated.body.currentValueMinor).toBe(0);

      const schedule = (await agent.get('/api/recurring')).body
        .find((r: { id: number }) => r.id === created.body.id);
      expect(schedule.active).toBe(false);
    });

    it('catch-up occurrences each buy at their own date\'s price, not one blended price', async () => {
      const asset = await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'BTC', quantity: 0.5,
      });
      await csrf(agent.post('/api/recurring')).send({
        name: 'DCA into BTC', targetType: 'asset', targetId: asset.body.id,
        amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-06-11',
      });
      world.advanceDays(35); // Jun 11 and Jul 11 both due
      agent = await loginAgent(world.app); // previous session expired with the clock jump
      expect(await runDueRecurring(world.ctx)).toBe(2);

      const price1 = world.ctx.prices.getPriceMinor('BTC', '2026-06-11')!;
      const afterFirst = 0.5 + 100_00 / price1;
      const price2 = world.ctx.prices.getPriceMinor('BTC', '2026-07-11')!;
      const expectedQuantity = afterFirst + 100_00 / price2;

      const updated = await agent.get(`/api/assets/${asset.body.id}`);
      expect(updated.body.quantity).toBeCloseTo(expectedQuantity, 6);
    });

    it('defers an occurrence with no available price instead of applying or erroring', async () => {
      const asset = await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'BTC', quantity: 0.5,
      });
      await csrf(agent.post('/api/recurring')).send({
        name: 'DCA into BTC', targetType: 'asset', targetId: asset.body.id,
        amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2019-06-11', // before the simulated provider's data starts
      });
      expect(await runDueRecurring(world.ctx)).toBe(0);

      const schedule = (await agent.get('/api/recurring')).body[0];
      expect(schedule.nextRunOn).toBe('2019-06-11'); // unchanged — deferred, not applied
      expect(schedule.active).toBe(true); // just waiting, not deactivated
      const updated = await agent.get(`/api/assets/${asset.body.id}`);
      expect(updated.body.quantity).toBe(0.5);
    });

    it('converts a foreign-currency instrument before computing the share count', async () => {
      // alice is USD; VWRL is priced in GBP.
      const asset = await csrf(agent.post('/api/assets')).send({
        category: 'investments', name: 'Global fund', valuationMode: 'market', marketSymbol: 'VWRL', quantity: 10,
      });
      await csrf(agent.post('/api/recurring')).send({
        name: 'DCA into VWRL', targetType: 'asset', targetId: asset.body.id,
        amountMinor: 500_00, cadence: 'monthly', nextRunOn: '2026-06-11',
      });
      expect(await runDueRecurring(world.ctx)).toBe(1);

      const priceGbp = world.ctx.prices.getPriceMinor('VWRL', '2026-06-11')!;
      const priceUsd = convertMinor(priceGbp, 'GBP', 'USD');
      const expectedQuantity = 10 + 500_00 / priceUsd;
      const updated = await agent.get(`/api/assets/${asset.body.id}`);
      expect(updated.body.quantity).toBeCloseTo(expectedQuantity, 6);
      expect(updated.body.currentValueMinor).toBe(Math.round(priceUsd * expectedQuantity));
    });
  });
});
