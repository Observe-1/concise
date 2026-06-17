import { describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld } from '../helpers.js';
import { backfillSnapshots } from '../../src/modules/snapshots/service.js';
import { startScheduler } from '../../src/jobs/scheduler.js';
import { seed } from '../../src/db/seed.js';

describe('snapshot backfill', () => {
  it('fills snapshot gaps after downtime', async () => {
    const world = makeTestWorld();
    const userId = createUser(world.ctx, 'alice', 'password123');
    const agent = await loginAgent(world.app);
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'A', valueMinor: 500 });

    world.advanceDays(5); // app "down" for 5 days
    backfillSnapshots(world.ctx, userId);

    const snaps = world.ctx.db
      .prepare('SELECT snapshot_date, assets_minor FROM snapshots WHERE user_id = ? ORDER BY snapshot_date')
      .all(userId) as { snapshot_date: string; assets_minor: number }[];
    expect(snaps.map((s) => s.snapshot_date)).toEqual([
      '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14', '2026-06-15', '2026-06-16',
    ]);
    expect(snaps.every((s) => s.assets_minor === 500)).toBe(true);
  });

  it('creates todays snapshot for users with none', () => {
    const world = makeTestWorld();
    const userId = createUser(world.ctx, 'bob', 'password123');
    backfillSnapshots(world.ctx, userId);
    const snaps = world.ctx.db
      .prepare('SELECT snapshot_date FROM snapshots WHERE user_id = ?')
      .all(userId) as { snapshot_date: string }[];
    expect(snaps).toEqual([{ snapshot_date: '2026-06-11' }]);
  });
});

describe('scheduler', () => {
  it('runs recurring catch-up, snapshots and market refresh on startup', async () => {
    const world = makeTestWorld();
    seed(world.ctx.db, world.ctx.now);
    // Make one schedule overdue so the startup tick has work to do.
    world.ctx.db
      .prepare("UPDATE recurring_transactions SET next_run_on = '2026-06-01' WHERE name = 'Mortgage payment'")
      .run();

    const { stop, firstTick } = startScheduler(world.ctx);
    await firstTick;
    stop();

    const overdue = world.ctx.db
      .prepare("SELECT next_run_on FROM recurring_transactions WHERE name = 'Mortgage payment'")
      .get() as { next_run_on: string };
    expect(overdue.next_run_on > '2026-06-11').toBe(true);

    const marketToday = world.ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM asset_valuations
         WHERE source = 'market' AND recorded_at >= '2026-06-11T00:00:00.000Z'`,
      )
      .get() as { n: number };
    expect(marketToday.n).toBe(3); // VWRL + BTC + XAU
  });
});
