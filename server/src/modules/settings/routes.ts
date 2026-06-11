import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { SettingsDto } from '../../types/api.js';
import { audit } from '../../lib/audit.js';
import { parseBody } from '../../lib/http.js';

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/, 'Expected ISO 4217 code').optional(),
});

function getSettings(ctx: AppContext, userId: number): SettingsDto {
  const row = ctx.db
    .prepare(
      `SELECT u.username, u.display_name, COALESCE(s.currency, 'USD') AS currency
       FROM users u LEFT JOIN settings s ON s.user_id = u.id WHERE u.id = ?`,
    )
    .get(userId) as { username: string; display_name: string; currency: string };
  return { username: row.username, displayName: row.display_name, currency: row.currency };
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
    audit(ctx.db, { userId, action: 'settings.update', detail: patch, ip: req.ip });
    res.json(getSettings(ctx, userId));
  });

  return router;
}
