import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { SettingsDto } from '../../types/api.js';
import { withTransaction } from '../../db/connection.js';
import { audit } from '../../lib/audit.js';
import { badRequest, parseBody } from '../../lib/http.js';
import { refreshTodaySnapshot } from '../snapshots/service.js';

/** Exact phrase the user must type to confirm a destructive wipe. */
const DELETE_ALL_PHRASE = 'delete all';

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/, 'Expected ISO 4217 code').optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
});

function getSettings(ctx: AppContext, userId: number): SettingsDto {
  const row = ctx.db
    .prepare(
      `SELECT u.username, u.display_name, COALESCE(s.currency, 'USD') AS currency, s.birth_year
       FROM users u LEFT JOIN settings s ON s.user_id = u.id WHERE u.id = ?`,
    )
    .get(userId) as { username: string; display_name: string; currency: string; birth_year: number | null };
  return {
    username: row.username,
    displayName: row.display_name,
    currency: row.currency,
    birthYear: row.birth_year ?? null,
  };
}

export function settingsRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(getSettings(ctx, req.user!.id));
  });

  router.patch('/', (req, res) => {
    const patch = parseBody(updateSchema, req.body);
    const userId = req.user!.id;
    if (patch.displayName !== undefined) {
      ctx.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.displayName, userId);
    }
    if (patch.currency !== undefined) {
      ctx.db
        .prepare(
          `INSERT INTO settings (user_id, currency) VALUES (?, ?)
           ON CONFLICT (user_id) DO UPDATE SET currency = excluded.currency`,
        )
        .run(userId, patch.currency.toUpperCase());
    }
    if (patch.birthYear !== undefined) {
      ctx.db
        .prepare(
          `INSERT INTO settings (user_id, birth_year) VALUES (?, ?)
           ON CONFLICT (user_id) DO UPDATE SET birth_year = excluded.birth_year`,
        )
        .run(userId, patch.birthYear);
    }
    audit(ctx.db, { userId, action: 'settings.update', detail: patch, ip: req.ip });
    res.json(getSettings(ctx, userId));
  });

  // Wipe all of the user's financial data (assets, liabilities, their
  // valuations via cascade, recurring schedules and net-worth snapshots). The
  // account, session and preferences are kept. Guarded by the exact phrase as
  // a server-side backstop to the UI's tickbox + typed confirmation.
  router.post('/delete-all', (req, res) => {
    const { confirm } = parseBody(z.object({ confirm: z.string() }), req.body);
    if (confirm.trim().toLowerCase() !== DELETE_ALL_PHRASE) {
      throw badRequest(`Type "${DELETE_ALL_PHRASE}" exactly to confirm.`);
    }
    const userId = req.user!.id;
    withTransaction(ctx.db, () => {
      ctx.db.prepare('DELETE FROM recurring_transactions WHERE user_id = ?').run(userId);
      ctx.db.prepare('DELETE FROM assets WHERE user_id = ?').run(userId); // cascades asset_valuations
      ctx.db.prepare('DELETE FROM liabilities WHERE user_id = ?').run(userId); // cascades liability_valuations
      ctx.db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(userId);
    });
    // Leave a clean baseline snapshot for today (zero everything).
    refreshTodaySnapshot(ctx, userId);
    audit(ctx.db, { userId, action: 'settings.delete_all', ip: req.ip });
    res.status(204).end();
  });

  return router;
}
