import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = path.join(import.meta.dirname, 'migrations');

/** Apply pending .sql migrations in filename order. Each runs in its own transaction. */
export function migrate(db: DatabaseSync, migrationsDir: string = DEFAULT_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
  );
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
    newlyApplied.push(file);
  }
  return newlyApplied;
}
