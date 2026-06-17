import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { SettingsDto } from '../../types/api.js';
import { withTransaction } from '../../db/connection.js';
import { audit } from '../../lib/audit.js';
import { convertMinor } from '../../lib/fx.js';
import { badRequest, parseBody } from '../../lib/http.js';
import { refreshTodaySnapshot } from '../snapshots/service.js';

/** Exact phrase the user must type to confirm a destructive wipe. */
const DELETE_ALL_PHRASE = 'delete all';

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/, 'Expected ISO 4217 code').optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
});

/**
 * Switch the user's display currency and re-denominate every stored figure at
 * the latest rough rate, so the whole portfolio and its history read in the new
 * currency. The conversion is a single constant factor, so the shape of the
 * graph is preserved — only the units change. Runs in one transaction with the
 * currency update so a failure can't leave values half-converted.
 */
function changeCurrency(ctx: AppContext, userId: number, next: string): void {
  const prev = getSettings(ctx, userId).currency;
  withTransaction(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO settings (user_id, currency) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET currency = excluded.currency`,
      )
      .run(userId, next);
    if (next === prev) return;
    const convert = (v: number) => convertMinor(v, prev, next);

    const assetVals = ctx.db
      .prepare(
        `SELECT v.id, v.value_minor FROM asset_valuations v
         JOIN assets a ON a.id = v.asset_id WHERE a.user_id = ?`,
      )
      .all(userId) as { id: number; value_minor: number }[];
    const updAssetVal = ctx.db.prepare('UPDATE asset_valuations SET value_minor = ? WHERE id = ?');
    for (const r of assetVals) updAssetVal.run(convert(r.value_minor), r.id);

    const liabVals = ctx.db
      .prepare(
        `SELECT v.id, v.value_minor FROM liability_valuations v
         JOIN liabilities l ON l.id = v.liability_id WHERE l.user_id = ?`,
      )
      .all(userId) as { id: number; value_minor: number }[];
    const updLiabVal = ctx.db.prepare('UPDATE liability_valuations SET value_minor = ? WHERE id = ?');
    for (const r of liabVals) updLiabVal.run(convert(r.value_minor), r.id);

    const snaps = ctx.db
      .prepare('SELECT id, assets_minor, liabilities_minor, net_worth_minor FROM snapshots WHERE user_id = ?')
      .all(userId) as { id: number; assets_minor: number; liabilities_minor: number; net_worth_minor: number }[];
    const updSnap = ctx.db.prepare(
      'UPDATE snapshots SET assets_minor = ?, liabilities_minor = ?, net_worth_minor = ? WHERE id = ?',
    );
    for (const s of snaps) {
      updSnap.run(convert(s.assets_minor), convert(s.liabilities_minor), convert(s.net_worth_minor), s.id);
    }

    // Fixed recurring amounts are money; percent schedules are currency-agnostic.
    const recs = ctx.db
      .prepare("SELECT id, amount_minor FROM recurring_transactions WHERE user_id = ? AND amount_type = 'fixed'")
      .all(userId) as { id: number; amount_minor: number }[];
    const updRec = ctx.db.prepare('UPDATE recurring_transactions SET amount_minor = ? WHERE id = ?');
    for (const r of recs) {
      let v = convert(r.amount_minor);
      if (v === 0) v = r.amount_minor < 0 ? -1 : 1; // keep the amount_minor != 0 CHECK
      updRec.run(v, r.id);
    }
  });
}

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
      changeCurrency(ctx, userId, patch.currency.toUpperCase());
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
