import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { convertMinor } from '../../src/lib/fx.js';

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
    expect(res.body).toEqual({ username: 'alice', displayName: 'alice', currency: 'USD', birthYear: null });
  });

  it('sets, exposes and clears the birth year', async () => {
    const set = await csrf(agent.patch('/api/settings')).send({ birthYear: 1990 });
    expect(set.body.birthYear).toBe(1990);

    // flows into the session user for the chart age overlay
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.birthYear).toBe(1990);

    const cleared = await csrf(agent.patch('/api/settings')).send({ birthYear: null });
    expect(cleared.body.birthYear).toBeNull();
  });

  it('validates birth year bounds', async () => {
    await csrf(agent.patch('/api/settings')).send({ birthYear: 1800 }).expect(400);
    await csrf(agent.patch('/api/settings')).send({ birthYear: 2150 }).expect(400);
    await csrf(agent.patch('/api/settings')).send({ birthYear: 1990.5 }).expect(400);
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

  it('re-denominates stored values when the currency changes', async () => {
    // A $1,000.00 asset, a $400.00 liability and a fixed +$100.00 schedule.
    const asset = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Loan', valueMinor: 400_00 });
    await csrf(agent.post('/api/recurring')).send({
      name: 'Top up', targetType: 'asset', targetId: asset.body.id,
      amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-07-11',
    });

    // Switch USD → GBP: every figure converts at the rough rate.
    await csrf(agent.patch('/api/settings')).send({ currency: 'GBP' }).expect(200);

    const assets = await agent.get('/api/assets');
    expect(assets.body[0].currentValueMinor).toBe(convertMinor(1_000_00, 'USD', 'GBP'));
    const liabilities = await agent.get('/api/liabilities');
    expect(liabilities.body[0].currentValueMinor).toBe(convertMinor(400_00, 'USD', 'GBP'));

    const summary = await agent.get('/api/dashboard/summary');
    expect(summary.body.currency).toBe('GBP');
    expect(summary.body.assetsMinor).toBe(convertMinor(1_000_00, 'USD', 'GBP'));
    expect(summary.body.liabilitiesMinor).toBe(convertMinor(400_00, 'USD', 'GBP'));

    const rec = await agent.get('/api/recurring');
    expect(rec.body[0].amountMinor).toBe(convertMinor(100_00, 'USD', 'GBP'));

    // Snapshots (the graph series) are re-denominated too.
    const snap = world.ctx.db
      .prepare("SELECT net_worth_minor FROM snapshots WHERE user_id = ? AND snapshot_date = '2026-06-11'")
      .get(1) as { net_worth_minor: number };
    expect(snap.net_worth_minor).toBe(convertMinor(600_00, 'USD', 'GBP'));
  });

  it('is a no-op when the currency is unchanged', async () => {
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    await csrf(agent.patch('/api/settings')).send({ currency: 'USD' }).expect(200);
    const assets = await agent.get('/api/assets');
    expect(assets.body[0].currentValueMinor).toBe(1_000_00);
  });

  it('deletes all financial data on confirmation, keeping the account', async () => {
    // Seed some data: an asset, a liability and a recurring schedule.
    const asset = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 1_000_00 });
    await csrf(agent.post('/api/liabilities'))
      .send({ category: 'loan', name: 'Loan', valueMinor: 500_00 });
    await csrf(agent.post('/api/recurring')).send({
      name: 'Save', targetType: 'asset', targetId: asset.body.id,
      amountMinor: 100_00, cadence: 'monthly', nextRunOn: '2026-07-11',
    });
    expect((await agent.get('/api/assets')).body.length).toBe(1);

    // Wrong phrase is rejected and changes nothing.
    await csrf(agent.post('/api/settings/delete-all')).send({ confirm: 'nope' }).expect(400);
    expect((await agent.get('/api/assets')).body.length).toBe(1);

    // Correct phrase wipes assets, liabilities, recurring and snapshots.
    await csrf(agent.post('/api/settings/delete-all')).send({ confirm: 'delete all' }).expect(204);
    expect((await agent.get('/api/assets')).body).toEqual([]);
    expect((await agent.get('/api/liabilities')).body).toEqual([]);
    expect((await agent.get('/api/recurring')).body).toEqual([]);

    // The account and session survive — settings still load.
    const settings = await agent.get('/api/settings');
    expect(settings.body.username).toBe('alice');

    // A clean baseline snapshot for today remains (zero net worth).
    const summary = await agent.get('/api/dashboard/summary');
    expect(summary.body.netWorthMinor).toBe(0);
    expect(summary.body.assetsMinor).toBe(0);
  });
});
