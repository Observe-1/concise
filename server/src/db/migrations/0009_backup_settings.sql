-- Global database-backup configuration. Backups cover the whole SQLite file
-- (not one user's data), so this is a single global row, not a per-user table.
-- The id = 1 CHECK enforces exactly one row. See BACKUP.md.

CREATE TABLE backup_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  name_prefix    TEXT NOT NULL DEFAULT 'concise-backup'
                   CHECK (length(name_prefix) BETWEEN 1 AND 64),
  keep_count     INTEGER NOT NULL DEFAULT 10 CHECK (keep_count >= 1),
  auto_enabled   INTEGER NOT NULL DEFAULT 1 CHECK (auto_enabled IN (0,1)),
  interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (interval_hours >= 1),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Seed the single row with defaults (automatic backups ON).
INSERT INTO backup_settings (id) VALUES (1);
