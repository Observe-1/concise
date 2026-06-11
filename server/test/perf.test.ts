import { describe, expect, it } from 'vitest';
import { loginAgent, makeTestWorld } from './helpers.js';
import { seed } from '../src/db/seed.js';

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

// Generous local thresholds — this is a regression tripwire, not a benchmark.
describe('API performance (seeded portfolio, in-memory db)', () => {
  it('keeps dashboard endpoints fast', async () => {
    const world = makeTestWorld();
    seed(world.ctx.db, world.ctx.now);
    const agent = await loginAgent(world.app, 'demo', 'demo');

    // warm-up
    await agent.get('/api/dashboard/summary').expect(200);
    await agent.get('/api/dashboard/history?range=ALL').expect(200);

    const summaryTimes: number[] = [];
    const historyTimes: number[] = [];
    for (let i = 0; i < 30; i++) {
      let t = performance.now();
      await agent.get('/api/dashboard/summary').expect(200);
      summaryTimes.push(performance.now() - t);

      t = performance.now();
      await agent.get('/api/dashboard/history?range=ALL').expect(200);
      historyTimes.push(performance.now() - t);
    }

    expect(percentile(summaryTimes, 95)).toBeLessThan(150);
    expect(percentile(historyTimes, 95)).toBeLessThan(200);
  }, 30_000);

  it('keeps holdings listing fast', async () => {
    const world = makeTestWorld();
    seed(world.ctx.db, world.ctx.now);
    const agent = await loginAgent(world.app, 'demo', 'demo');

    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      await agent.get('/api/assets').expect(200);
      times.push(performance.now() - t);
    }
    expect(percentile(times, 95)).toBeLessThan(100);
  }, 30_000);
});
