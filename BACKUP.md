# Concise — Database backups

> Code is the source of truth. This document describes backups as implemented.
> See [ARCHITECTURE.md](ARCHITECTURE.md) for the wider system and
> [HEALTHCHECK.md](HEALTHCHECK.md) for the monitoring endpoints.

Concise stores everything in a single SQLite file (see ARCHITECTURE.md §1), so a
backup is a copy of that file. The app makes those copies for you — on a
schedule, on demand, and on startup if the last one is stale — keeps a bounded
number of them, and surfaces their state in the UI and the health endpoint.

## How a backup is made

A backup is a **standalone, point-in-time copy** of the live database:

1. **Checkpoint.** `PRAGMA wal_checkpoint(TRUNCATE)` flushes the write-ahead log
   into the main `.db` file and empties the WAL, so the single file is fully
   consistent. (Concise runs WAL mode — see ARCHITECTURE.md §1.)
2. **Copy.** The `.db` file is copied to the backup directory. `node:sqlite` is
   synchronous and Concise is a single process, so no write can interleave with
   the copy — the snapshot is atomic in practice.
3. **Validate.** The copy is reopened read-only and `PRAGMA integrity_check` is
   run against it. A backup is only reported as successful once SQLite confirms
   the copy is a structurally sound database; a failed check raises an error and
   no success is reported.

Because the WAL is checkpointed first, each backup is a self-contained file you
can restore by stopping the app and copying it over `concise.db` (delete any
stale `concise.db-wal` / `concise.db-shm` alongside it first).

## Where backups live

Backups are written to a dedicated directory next to the database. By default
that is a `backups/` folder beside `DB_PATH`:

| Deployment | `DB_PATH` | Backup directory |
|------------|-----------|------------------|
| Local dev  | `data/concise.db` | `data/backups/` |
| Docker     | `/data/concise.db` | `/data/backups/` |

Override it with the `BACKUP_DIR` environment variable. In Docker the default
keeps backups on the same persistent `/data` volume as the database, so they
survive container rebuilds. (For disaster recovery you should still copy the
volume — or `BACKUP_DIR` — off the host periodically; an on-volume backup does
not protect against losing the volume itself.)

Backup files are named `<prefix>-<timestamp>.db`, e.g.
`concise-backup-2026-06-15T12-00-00-000Z.db`. The prefix is configurable; the
timestamp is the UTC instant the backup was taken (colons are replaced with
dashes so the name is valid on every filesystem, Windows included).

## Automatic backups

Automatic backups are **on by default**. The in-process job scheduler (see
ARCHITECTURE.md §6.5) checks on every tick whether a backup is due:

- A backup is **due** when automatic backups are enabled *and* the newest backup
  is older than the configured interval — **or** there is no backup at all.
- The scheduler runs a tick immediately on startup, so the same check doubles as
  the **startup catch-up**: if the app has been down and the most recent backup
  is now stale (or none exists), a fresh backup is taken right away.
- The check is a cheap directory stat, so running it every tick is free; an
  actual copy happens at most once per interval.

The default interval is **24 hours**. Automatic backups count toward the
retention limit exactly like manual ones.

## Manual backups

The **Settings → Backup** page has a *Back up now* button that runs the same
make-and-validate process on demand. On success it shows a green confirmation
(the backup was created *and* validated to exist) and refreshes the list of
existing backups. Manual backups obey the same retention limit.

## Retention

Concise keeps the **N most recent** backups and deletes the rest after every
backup (manual or automatic). The limit (default **10**) is shared: manual and
automatic backups are pruned together as one pool, oldest first. Lowering the
limit prunes down to the new number on the next backup.

## Configurable settings

All settings live in the `backup_settings` table (a single global row — backups
cover the whole database, not one user's data) and are editable from
**Settings → Backup**:

| Setting | Default | Meaning |
|---------|---------|---------|
| **Name** (prefix) | `concise-backup` | Filename prefix for new backups. |
| **Keep** (retention) | `10` | How many backups to retain — manual **and** automatic combined. |
| **Automatic backups** | `on` | Whether the scheduler creates backups automatically. |
| **Interval (hours)** | `24` | How often automatic backups run, and the staleness threshold for the startup catch-up. |

Settings are global and changeable by any signed-in user, in keeping with
Concise's small, self-hosted, single-household model.

## API

All endpoints are authenticated and mounted under `/api/backup`.

| Method & path | Purpose |
|---------------|---------|
| `GET /api/backup` | Overview: current settings, backup directory, and the list of existing backups (name, size, timestamp). |
| `POST /api/backup/run` | Take a backup now; returns the new backup and the refreshed list. `201` on success. |
| `PATCH /api/backup/settings` | Update any of the configurable settings. |

The detailed health endpoint also reports a non-sensitive **backup** block — see
below.

## Health endpoint

`GET /api/health/detailed` includes a `backup` section so monitors and
dashboards can alert when backups go stale:

```jsonc
"backup": {
  "lastBackupAt": "2026-06-15T12:00:00.000Z",  // null if none yet
  "lastBackupName": "concise-backup-2026-06-15T12-00-00-000Z.db",
  "location": "/data/backups",
  "count": 7
}
```

Like the rest of that endpoint it carries **no financial or account data** — only
operational facts about the backup files (see HEALTHCHECK.md's privacy
guarantee). The backup directory path is intentionally included as operational
diagnostics; it is the same path already documented for deployment.

## Restoring from a backup

1. Stop the app / container.
2. Replace `concise.db` with the chosen backup file (rename it to `concise.db`),
   and remove any leftover `concise.db-wal` / `concise.db-shm`.
3. Start the app. Migrations run on startup and are idempotent, so a backup taken
   on an older schema is brought up to date automatically.

## Where it lives in the code

- Service: [server/src/modules/backup/service.ts](server/src/modules/backup/service.ts)
- Routes: [server/src/modules/backup/routes.ts](server/src/modules/backup/routes.ts)
- Scheduler hook: [server/src/jobs/scheduler.ts](server/src/jobs/scheduler.ts)
- Schema: [server/src/db/migrations/0009_backup_settings.sql](server/src/db/migrations/0009_backup_settings.sql)
- Config (`backupDir`): [server/src/config.ts](server/src/config.ts)
- DTOs: `Backup*Dto` / `HealthBackup` in [server/src/types/api.ts](server/src/types/api.ts)
- Web UI: the Backup section in [web/src/pages/SettingsPage.tsx](web/src/pages/SettingsPage.tsx)
- Tests: [server/test/integration/backup.test.ts](server/test/integration/backup.test.ts),
  [web/test/backup.test.tsx](web/test/backup.test.tsx)
