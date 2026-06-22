import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { BackupOverviewDto, BackupRunResultDto } from '../../types/api.js';
import { audit } from '../../lib/audit.js';
import { badRequest, HttpError, parseBody } from '../../lib/http.js';
import {
  createBackup, getBackupSettings, listBackups, updateBackupSettings,
} from './service.js';

/** Database-backup management: overview, on-demand backup, and settings. All
 *  routes are authenticated; settings are global (see BACKUP.md). */
export function backupRoutes(ctx: AppContext): Router {
  const router = Router();

  // Everything the Settings → Backup page needs in one request.
  router.get('/', (_req, res) => {
    res.json({
      settings: getBackupSettings(ctx),
      location: ctx.config.backupDir,
      backups: listBackups(ctx),
    } satisfies BackupOverviewDto);
  });

  // Take a backup now. Validation (the copy exists and passes an integrity
  // check) happens inside createBackup; a failure surfaces as a clean 500.
  router.post('/run', (req, res) => {
    if (ctx.config.dbPath === ':memory:') {
      throw badRequest('Backups are unavailable for an in-memory database.');
    }
    let backup;
    try {
      backup = createBackup(ctx);
    } catch (err) {
      (req.log ?? ctx.log).error({ err }, 'manual backup failed');
      throw new HttpError(500, 'Backup failed. Check the server logs and that the backup directory is writable.');
    }
    audit(ctx.db, { userId: req.user!.id, action: 'backup.create', detail: { name: backup.name }, ip: req.ip });
    res.status(201).json({ backup, backups: listBackups(ctx) } satisfies BackupRunResultDto);
  });

  const settingsSchema = z
    .object({
      namePrefix: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes and underscores only')
        .optional(),
      keepCount: z.number().int().min(1).max(1000).optional(),
      autoEnabled: z.boolean().optional(),
      intervalHours: z.number().int().min(1).max(8760).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'No settings to update' });

  router.patch('/settings', (req, res) => {
    const patch = parseBody(settingsSchema, req.body);
    const settings = updateBackupSettings(ctx, patch);
    audit(ctx.db, { userId: req.user!.id, action: 'backup.settings.update', detail: patch, ip: req.ip });
    res.json(settings);
  });

  return router;
}
