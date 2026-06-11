import type { AppContext } from '../context.js';
import { todayISO } from '../lib/dates.js';
import { purgeExpiredSessions } from '../modules/auth/service.js';
import { refreshMarketValuations } from '../modules/market/service.js';
import { runDueRecurring } from '../modules/recurring/service.js';
import { allUserIds, backfillSnapshots } from '../modules/snapshots/service.js';

const TICK_MS = 60_000;

/**
 * In-process background jobs. Every effect is idempotent, so a missed tick
 * (downtime, crash) self-heals on the next one:
 *  - recurring engine: cursor-based catch-up, runs every tick (cheap index scan)
 *  - daily housekeeping (first tick of each calendar day): snapshot backfill,
 *    market re-pricing, expired-session purge
 *
 * Returns a stop function.
 */
export function startScheduler(ctx: AppContext): () => void {
  let lastDailyRun: string | null = null;

  const tick = () => {
    try {
      const applied = runDueRecurring(ctx);
      if (applied > 0) console.log(`[jobs] applied ${applied} recurring occurrence(s)`);

      const today = todayISO(ctx.now);
      if (lastDailyRun !== today) {
        for (const userId of allUserIds(ctx.db)) backfillSnapshots(ctx, userId);
        const repriced = refreshMarketValuations(ctx);
        purgeExpiredSessions(ctx);
        lastDailyRun = today;
        console.log(`[jobs] daily housekeeping done for ${today} (${repriced} market valuation(s))`);
      }
    } catch (err) {
      console.error('[jobs] tick failed:', err);
    }
  };

  tick(); // run immediately on startup to catch up after downtime
  const handle = setInterval(tick, TICK_MS);
  handle.unref();
  return () => clearInterval(handle);
}
