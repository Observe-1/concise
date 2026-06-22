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
 * Returns a stop function plus `firstTick`, a promise that resolves when the
 * immediate startup tick (run to catch up after downtime) has finished — handy
 * for deterministic tests and graceful startup ordering.
 */
export function startScheduler(ctx: AppContext): { stop: () => void; firstTick: Promise<void> } {
  let lastDailyRun: string | null = null;

  const tick = async (): Promise<void> => {
    try {
      const applied = runDueRecurring(ctx);
      if (applied > 0) ctx.log.info({ applied }, 'applied recurring occurrences');

      const today = todayISO(ctx.now);
      if (lastDailyRun !== today) {
        for (const userId of allUserIds(ctx.db)) backfillSnapshots(ctx, userId);
        // Re-pricing fetches live quotes (real provider), so it is async; it is
        // idempotent (one valuation per asset per day) and isolated by the
        // try/catch, so a flaky feed can never wedge the rest of housekeeping.
        const repriced = await refreshMarketValuations(ctx);
        purgeExpiredSessions(ctx);
        lastDailyRun = today;
        ctx.log.info({ date: today, marketValuations: repriced }, 'daily housekeeping complete');
      }
    } catch (err) {
      ctx.log.error({ err }, 'job tick failed');
    }

    // Automatic backups run on their own interval (not daily), so check every
    // tick. Isolated from the block above so a backup failure can never block
    // the recurring/snapshot engine, and vice versa.
    try {
      const backup = maybeAutoBackup(ctx);
      if (backup) ctx.log.info({ backup: backup.name }, 'automatic backup created');
    } catch (err) {
      ctx.log.error({ err }, 'automatic backup failed');
    }
  };

  const firstTick = tick(); // run immediately on startup to catch up after downtime
  const handle = setInterval(() => void tick(), ctx.config.jobTickMs);
  handle.unref();
  return { stop: () => clearInterval(handle), firstTick };
}
