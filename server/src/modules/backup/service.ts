import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../../context.js';
import type { BackupFileDto, BackupSettingsDto, HealthBackup } from '../../types/api.js';

/**
 * Database backups. A backup is a standalone point-in-time copy of the SQLite
 * file: checkpoint the WAL into the main file, copy it, then validate the copy
 * with an integrity check. The list of backups is derived from the filesystem
 * (the source of truth), while behaviour (prefix, retention, automatic
 * cadence) lives in the single-row `backup_settings` table. See BACKUP.md.
 */

/** The settings table holds exactly one row. */
const SETTINGS_ID = 1;
const BACKUP_EXT = '.db';
/** Recognises the timestamp a backup filename ends with, e.g.
 *  "concise-backup-2026-06-15T12-00-00-000Z.db". Independent of the (possibly
 *  dash-containing) prefix. */
const TIMESTAMP_RE = /(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;

const DEFAULTS: BackupSettingsDto = {
  namePrefix: 'concise-backup',
  keepCount: 10,
  autoEnabled: true,
  intervalHours: 24,
};

interface BackupSettingsRow {
  name_prefix: string;
  keep_count: number;
  auto_enabled: number;
  interval_hours: number;
}

export function getBackupSettings(ctx: AppContext): BackupSettingsDto {
  const row = ctx.db
    .prepare('SELECT name_prefix, keep_count, auto_enabled, interval_hours FROM backup_settings WHERE id = ?')
    .get(SETTINGS_ID) as BackupSettingsRow | undefined;
  if (!row) return { ...DEFAULTS }; // the migration seeds this; be defensive
  return {
    namePrefix: row.name_prefix,
    keepCount: row.keep_count,
    autoEnabled: row.auto_enabled === 1,
    intervalHours: row.interval_hours,
  };
}

export interface BackupSettingsPatch {
  namePrefix?: string;
  keepCount?: number;
  autoEnabled?: boolean;
  intervalHours?: number;
}

export function updateBackupSettings(ctx: AppContext, patch: BackupSettingsPatch): BackupSettingsDto {
  const current = getBackupSettings(ctx);
  // ?? only falls back on null/undefined, so `autoEnabled: false` is honoured.
  const next: BackupSettingsDto = {
    namePrefix: patch.namePrefix ?? current.namePrefix,
    keepCount: patch.keepCount ?? current.keepCount,
    autoEnabled: patch.autoEnabled ?? current.autoEnabled,
    intervalHours: patch.intervalHours ?? current.intervalHours,
  };
  ctx.db
    .prepare(
      `UPDATE backup_settings
         SET name_prefix = ?, keep_count = ?, auto_enabled = ?, interval_hours = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(next.namePrefix, next.keepCount, next.autoEnabled ? 1 : 0, next.intervalHours, ctx.now().toISOString(), SETTINGS_ID);
  return next;
}

/** Filesystem-safe timestamp for a backup filename (colons/dots → dashes). */
function timestampForName(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-'); // 2026-06-15T12-00-00-000Z
}

/** Recover the ISO timestamp encoded in a backup filename, or null if absent. */
function createdAtFromName(name: string): string | null {
  const m = TIMESTAMP_RE.exec(name);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`;
}

/** Existing backups, newest first. Derived from the filesystem so a manually
 *  deleted file is reflected immediately. Returns [] if the dir is absent. */
export function listBackups(ctx: AppContext): BackupFileDto[] {
  let names: string[];
  try {
    names = fs.readdirSync(ctx.config.backupDir);
  } catch {
    return [];
  }
  const files: BackupFileDto[] = [];
  for (const name of names) {
    if (!name.endsWith(BACKUP_EXT)) continue;
    try {
      const stat = fs.statSync(path.join(ctx.config.backupDir, name));
      if (!stat.isFile()) continue;
      files.push({
        name,
        sizeBytes: stat.size,
        createdAt: createdAtFromName(name) ?? stat.mtime.toISOString(),
      });
    } catch {
      // unreadable entry — skip it
    }
  }
  files.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.name < b.name ? 1 : -1));
  return files;
}

/** Delete the oldest backups beyond `keepCount`. Returns the removed names. */
export function pruneBackups(ctx: AppContext, keepCount: number): string[] {
  const toDelete = listBackups(ctx).slice(Math.max(keepCount, 0));
  const removed: string[] = [];
  for (const f of toDelete) {
    try {
      fs.unlinkSync(path.join(ctx.config.backupDir, f.name));
      removed.push(f.name);
    } catch {
      // best-effort; a file that vanished is already "pruned"
    }
  }
  return removed;
}

/** Delete a file, ignoring "doesn't exist" and other unlink errors. */
function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone, or not ours to remove — nothing to do
  }
}

/** A backup copy's SQLite companion files, created transiently when the copy is
 *  opened (validation) and never part of the standalone backup itself. */
function companionFiles(filePath: string): string[] {
  return [`${filePath}-wal`, `${filePath}-shm`];
}

/**
 * Take a backup now: checkpoint the WAL, copy the database file, validate the
 * copy, then prune to the retention limit. Returns the created backup. Throws
 * if the database is in-memory (nothing to copy) or the copy fails validation.
 * On any failure after the copy starts, the partial/invalid file (and any
 * transient companion files) is removed so corrupt backups never linger.
 */
export function createBackup(ctx: AppContext): BackupFileDto {
  if (ctx.config.dbPath === ':memory:') {
    throw new Error('Cannot back up an in-memory database');
  }
  const settings = getBackupSettings(ctx);
  fs.mkdirSync(ctx.config.backupDir, { recursive: true });

  // Pick a filename that does not already exist. Two backups within the same
  // millisecond (manual + automatic, a backward clock step) would otherwise
  // collide and the copy would silently overwrite the earlier one; bump the
  // encoded timestamp until it is unique. The name stays parseable (see
  // createdAtFromName), so createdAt still reflects the real instant.
  let when = ctx.now();
  let name = `${settings.namePrefix}-${timestampForName(when)}${BACKUP_EXT}`;
  let dest = path.join(ctx.config.backupDir, name);
  while (fs.existsSync(dest)) {
    when = new Date(when.getTime() + 1);
    name = `${settings.namePrefix}-${timestampForName(when)}${BACKUP_EXT}`;
    dest = path.join(ctx.config.backupDir, name);
  }

  // Flush the WAL into the main file so a plain copy is fully consistent.
  // node:sqlite is synchronous and Concise is single-process, so no writer can
  // interleave with the (synchronous) copy. See BACKUP.md.
  ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  try {
    fs.copyFileSync(ctx.config.dbPath, dest);
    validateBackup(dest);
  } catch (err) {
    // A disk-full copy or a failed integrity check must not leave a corrupt
    // file behind (it would still be listed and count toward retention).
    safeUnlink(dest);
    for (const f of companionFiles(dest)) safeUnlink(f);
    throw err;
  }

  const stat = fs.statSync(dest);
  const created: BackupFileDto = {
    name,
    sizeBytes: stat.size,
    createdAt: createdAtFromName(name) ?? stat.mtime.toISOString(),
  };

  pruneBackups(ctx, settings.keepCount);
  return created;
}

/** Reopen the copy read-only and confirm SQLite considers it sound. Opening a
 *  WAL-mode database creates transient -wal/-shm files even read-only, so they
 *  are removed afterwards — the standalone backup is the single .db file. */
function validateBackup(filePath: string): void {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error('Backup file was not created');
  }
  let probe: DatabaseSync | undefined;
  try {
    probe = new DatabaseSync(filePath, { readOnly: true });
    const row = probe.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (row?.integrity_check !== 'ok') {
      throw new Error('Backup failed integrity check');
    }
  } finally {
    probe?.close();
    for (const f of companionFiles(filePath)) safeUnlink(f);
  }
}

/**
 * Verify the backup directory exists and is writable, creating it if needed.
 * Called once at startup so a misconfigured BACKUP_DIR (e.g. pointing outside
 * the writable volume on a read-only container rootfs) surfaces as a loud log
 * line instead of silently failing every backup. Returns false (and logs) on
 * failure rather than aborting startup — the app's core function does not
 * depend on backups. No-op for an in-memory database.
 */
export function checkBackupDir(ctx: AppContext): boolean {
  if (ctx.config.dbPath === ':memory:') return true;
  try {
    fs.mkdirSync(ctx.config.backupDir, { recursive: true });
    fs.accessSync(ctx.config.backupDir, fs.constants.W_OK);
    return true;
  } catch (err) {
    ctx.log.error(
      { backupDir: ctx.config.backupDir, reason: (err as Error).message },
      'backup directory is not writable; backups will fail until BACKUP_DIR points at a writable path',
    );
    return false;
  }
}

/** Non-sensitive backup summary for the health endpoint and overviews. */
export function backupStatus(ctx: AppContext): HealthBackup {
  const files = listBackups(ctx);
  const latest = files[0];
  return {
    lastBackupAt: latest?.createdAt ?? null,
    lastBackupName: latest?.name ?? null,
    location: ctx.config.backupDir,
    count: files.length,
  };
}

/** True when a backup is overdue: none exist, or the newest is older than
 *  `intervalHours`. Uses the clock-driven timestamp encoded in the filename. */
export function isBackupDue(ctx: AppContext, intervalHours: number): boolean {
  const latest = listBackups(ctx)[0];
  if (!latest) return true;
  const ageMs = ctx.now().getTime() - new Date(latest.createdAt).getTime();
  return ageMs >= intervalHours * 3_600_000;
}

/**
 * Scheduler hook: create a backup if automatic backups are enabled and one is
 * due. Cheap to call every tick (a directory stat). Because the scheduler runs
 * a tick on startup, this also performs the "back up now if stale on boot"
 * catch-up. No-op for an in-memory database. Returns the new backup or null.
 */
export function maybeAutoBackup(ctx: AppContext): BackupFileDto | null {
  if (ctx.config.dbPath === ':memory:') return null;
  const settings = getBackupSettings(ctx);
  if (!settings.autoEnabled) return null;
  if (!isBackupDue(ctx, settings.intervalHours)) return null;
  return createBackup(ctx);
}
