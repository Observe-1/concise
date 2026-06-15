import type { AppContext } from '../context.js';
import { todayISO } from '../lib/dates.js';
import { purgeExpiredSessions } from '../modules/auth/service.js';
import { maybeAutoBackup } from '../modules/backup/service.js';
import { refreshMarketValuations } from '../modules/market/service.js';
import { runDueRecurring } from '../modules/recurring/service.js';
import { allUserIds, backfillSnapshots } from '../modules/snapshots/service.js';

/**
 * In-process background jobs. Every effect is idempotent, so a missed tick
 * (downtime, crash) self-heals on the next one:
 *  - recurring engine: cursor-based catch-up, runs every tick (cheap index scan)
 *  - daily housekeeping (first tick of each calendar day): snapshot backfill,
 *    market re-pricing, expired-session purge
 *  - automatic backups (interval-based; checked every tick with a cheap stat):
 *    a backup is taken when one is due — which on the startup tick also covers
 *    the "back up now if stale on boot" catch-up. See BACKUP.md.
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

    // Automatic backups run on their own interval (not daily), so check every
    // tick. Isolated from the block above so a backup failure can never block
    // the recurring/snapshot engine, and vice versa.
    try {
      const backup = maybeAutoBackup(ctx);
      if (backup) console.log(`[jobs] automatic backup created: ${backup.name}`);
    } catch (err) {
      console.error('[jobs] automatic backup failed:', err);
    }
  };

  tick(); // run immediately on startup to catch up after downtime
  const handle = setInterval(tick, ctx.config.jobTickMs);
  handle.unref();
  return () => clearInterval(handle);
}
