import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import {
  createBackup, isBackupDue, listBackups, maybeAutoBackup, updateBackupSettings,
} from '../../src/modules/backup/service.js';
import { startScheduler } from '../../src/jobs/scheduler.js';

/** Backups need a real file database (you cannot copy :memory:), so each test
 *  gets its own temp dir holding the DB and a separate backup directory. */
function makeFileWorld(): { world: TestWorld; dir: string; backupDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-backup-'));
  const dbPath = path.join(dir, 'concise.db');
  const backupDir = path.join(dir, 'backups');
  const world = makeTestWorld({ dbPath, backupDir });
  return { world, dir, backupDir };
}

describe('backup service', () => {
  let world: TestWorld;
  let dir: string;
  let backupDir: string;

  beforeEach(() => {
    ({ world, dir, backupDir } = makeFileWorld());
    createUser(world.ctx, 'alice', 'password123');
  });

  afterEach(() => {
    world.ctx.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates a valid, restorable backup file', () => {
    const backup = createBackup(world.ctx);

    const onDisk = path.join(backupDir, backup.name);
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(backup.sizeBytes).toBeGreaterThan(0);
    expect(backup.name).toMatch(/^concise-backup-\d{4}-\d{2}-\d{2}T.*\.db$/);

    // The copy is a real SQLite database carrying the schema.
    const probe = new DatabaseSync(onDisk, { readOnly: true });
    const row = probe.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='users'").get() as { n: number };
    probe.close();
    expect(row.n).toBe(1);
  });

  it('leaves only the standalone .db file — no -wal/-shm companions', () => {
    createBackup(world.ctx);
    // Check the directory immediately (before opening the copy ourselves, which
    // would itself create transient companions).
    const entries = fs.readdirSync(backupDir);
    expect(entries.some((e) => e.endsWith('-wal') || e.endsWith('-shm'))).toBe(false);
    expect(entries.filter((e) => e.endsWith('.db'))).toHaveLength(1);
  });

  it('gives two same-instant backups distinct filenames (no silent overwrite)', () => {
    // The clock does not advance between these two calls.
    const first = createBackup(world.ctx);
    const second = createBackup(world.ctx);
    expect(second.name).not.toBe(first.name);
    expect(listBackups(world.ctx)).toHaveLength(2);
  });

  it('does not leave a file behind when validation fails', () => {
    // Point the source at a non-database file so the copy is not a valid DB and
    // the integrity check throws — createBackup must clean up after itself.
    const bogus = path.join(dir, 'not-a-db.db');
    fs.writeFileSync(bogus, 'this is not sqlite');
    world.ctx.config.dbPath = bogus;
    expect(() => createBackup(world.ctx)).toThrow();
    expect(listBackups(world.ctx)).toHaveLength(0);
    const entries = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    expect(entries).toHaveLength(0);
  });

  it('derives the timestamp from the filename (clock-driven, not mtime)', () => {
    world.setNow('2026-03-04T05:06:07.008Z');
    const backup = createBackup(world.ctx);
    expect(backup.name).toBe('concise-backup-2026-03-04T05-06-07-008Z.db');
    expect(backup.createdAt).toBe('2026-03-04T05:06:07.008Z');
  });

  it('lists backups newest first', () => {
    createBackup(world.ctx);
    world.advanceDays(1);
    const second = createBackup(world.ctx);
    world.advanceDays(1);
    const third = createBackup(world.ctx);

    const list = listBackups(world.ctx);
    expect(list.map((b) => b.name)).toEqual([third.name, second.name, expect.any(String)]);
    expect(list).toHaveLength(3);
  });

  it('prunes oldest backups beyond the keep count (manual and automatic together)', () => {
    updateBackupSettings(world.ctx, { keepCount: 2 });
    const names: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      world.advanceDays(1);
      names.push(createBackup(world.ctx).name);
    }
    const list = listBackups(world.ctx);
    expect(list).toHaveLength(2);
    // Only the two newest survive.
    expect(list.map((b) => b.name)).toEqual([names[3], names[2]]);
    // The pruned files are gone from disk.
    expect(fs.existsSync(path.join(backupDir, names[0]!))).toBe(false);
  });

  it('treats a backup as due only once the interval has elapsed', () => {
    expect(isBackupDue(world.ctx, 24)).toBe(true); // none yet
    createBackup(world.ctx);
    expect(isBackupDue(world.ctx, 24)).toBe(false); // fresh
    world.advanceDays(1); // +24h
    expect(isBackupDue(world.ctx, 24)).toBe(true);
  });

  it('auto-backup respects the enabled flag and the interval', () => {
    // Disabled → no-op even though none exist.
    updateBackupSettings(world.ctx, { autoEnabled: false });
    expect(maybeAutoBackup(world.ctx)).toBeNull();
    expect(listBackups(world.ctx)).toHaveLength(0);

    // Enabled and stale → creates one; immediately after, not due again.
    updateBackupSettings(world.ctx, { autoEnabled: true, intervalHours: 24 });
    expect(maybeAutoBackup(world.ctx)).not.toBeNull();
    expect(maybeAutoBackup(world.ctx)).toBeNull();
    expect(listBackups(world.ctx)).toHaveLength(1);
  });

  it('takes a backup on startup when none exist (scheduler first tick)', async () => {
    const { stop, firstTick } = startScheduler(world.ctx);
    await firstTick;
    stop();
    expect(listBackups(world.ctx).length).toBeGreaterThanOrEqual(1);
  });
});

describe('backup service — in-memory database', () => {
  it('is a no-op for auto-backup and refuses manual backups', () => {
    const world = makeTestWorld(); // :memory:
    expect(maybeAutoBackup(world.ctx)).toBeNull();
    expect(() => createBackup(world.ctx)).toThrow(/in-memory/i);
  });
});

describe('backup API', () => {
  let world: TestWorld;
  let dir: string;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    ({ world, dir } = makeFileWorld());
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  afterEach(() => {
    world.ctx.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the overview with default settings and an empty list', async () => {
    const res = await agent.get('/api/backup');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      namePrefix: 'concise-backup', keepCount: 10, autoEnabled: true, intervalHours: 24,
    });
    expect(res.body.backups).toEqual([]);
    expect(typeof res.body.location).toBe('string');
  });

  it('runs a manual backup and returns the refreshed list', async () => {
    const res = await csrf(agent.post('/api/backup/run')).send();
    expect(res.status).toBe(201);
    expect(res.body.backup.name).toMatch(/\.db$/);
    expect(res.body.backups).toHaveLength(1);
    expect(res.body.backups[0].name).toBe(res.body.backup.name);

    // It really persisted.
    const overview = await agent.get('/api/backup');
    expect(overview.body.backups).toHaveLength(1);
  });

  it('updates settings and rejects invalid values', async () => {
    const ok = await csrf(agent.patch('/api/backup/settings'))
      .send({ namePrefix: 'my-db', keepCount: 5, autoEnabled: false, intervalHours: 12 });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ namePrefix: 'my-db', keepCount: 5, autoEnabled: false, intervalHours: 12 });

    await csrf(agent.patch('/api/backup/settings')).send({ keepCount: 0 }).expect(400);
    await csrf(agent.patch('/api/backup/settings')).send({ namePrefix: 'bad/name' }).expect(400);
    await csrf(agent.patch('/api/backup/settings')).send({ intervalHours: 0 }).expect(400);

    // A new backup uses the updated prefix.
    const run = await csrf(agent.post('/api/backup/run')).send();
    expect(run.body.backup.name).toMatch(/^my-db-/);
  });

  it('requires authentication', async () => {
    const res = await request(world.app).get('/api/backup');
    expect(res.status).toBe(401);
  });
});
