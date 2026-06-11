import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

function freshDb(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

describe('schema', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = freshDb();
  });

  it('applies migrations idempotently', () => {
    expect(migrate(db)).toEqual([]);
  });

  it('enforces unique usernames case-insensitively', () => {
    db.prepare("INSERT INTO users (username, password_hash, display_name) VALUES ('alice', 'x', 'A')").run();
    expect(() =>
      db.prepare("INSERT INTO users (username, password_hash, display_name) VALUES ('Alice', 'x', 'A2')").run(),
    ).toThrow(/UNIQUE/);
  });

  it('rejects invalid asset categories', () => {
    const userId = insertUser(db);
    expect(() =>
      db.prepare("INSERT INTO assets (user_id, category, name) VALUES (?, 'yachts', 'Boat')").run(userId),
    ).toThrow(/CHECK/);
  });

  it('requires symbol and quantity for market-valued assets', () => {
    const userId = insertUser(db);
    expect(() =>
      db.prepare(
        "INSERT INTO assets (user_id, category, name, valuation_mode) VALUES (?, 'crypto', 'BTC', 'market')",
      ).run(userId),
    ).toThrow(/CHECK/);
  });

  it('rejects negative valuations', () => {
    const userId = insertUser(db);
    const assetId = insertAsset(db, userId);
    expect(() =>
      db.prepare(
        "INSERT INTO asset_valuations (asset_id, value_minor, source) VALUES (?, -100, 'manual')",
      ).run(assetId),
    ).toThrow(/CHECK/);
  });

  it('cascades valuations when an asset is deleted', () => {
    const userId = insertUser(db);
    const assetId = insertAsset(db, userId);
    db.prepare("INSERT INTO asset_valuations (asset_id, value_minor, source) VALUES (?, 100, 'manual')").run(assetId);
    db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM asset_valuations').get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('requires recurring transactions to target exactly one of asset/liability', () => {
    const userId = insertUser(db);
    const assetId = insertAsset(db, userId);
    const liabilityId = db
      .prepare("INSERT INTO liabilities (user_id, category, name) VALUES (?, 'loan', 'Loan')")
      .run(userId).lastInsertRowid as number;
    const insert = db.prepare(
      `INSERT INTO recurring_transactions (user_id, name, asset_id, liability_id, amount_minor, cadence, next_run_on)
       VALUES (?, 'r', ?, ?, 100, 'monthly', '2026-01-01')`,
    );
    expect(() => insert.run(userId, null, null)).toThrow(/CHECK/);
    expect(() => insert.run(userId, assetId, liabilityId)).toThrow(/CHECK/);
    expect(() => insert.run(userId, assetId, null)).not.toThrow();
  });

  it('enforces one snapshot per user per day', () => {
    const userId = insertUser(db);
    const insert = db.prepare(
      `INSERT INTO snapshots (user_id, snapshot_date, assets_minor, liabilities_minor, net_worth_minor)
       VALUES (?, '2026-01-01', 100, 50, 50)`,
    );
    insert.run(userId);
    expect(() => insert.run(userId)).toThrow(/UNIQUE/);
  });
});

describe('seed', () => {
  it('creates the demo account with portfolio, history and snapshots', () => {
    const db = freshDb();
    const now = () => new Date('2026-06-11T10:00:00Z');
    seed(db, now);

    const user = db.prepare("SELECT id FROM users WHERE username = 'demo'").get() as { id: number };
    expect(user).toBeDefined();

    const counts = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(counts('SELECT COUNT(*) AS n FROM assets')).toBe(8);
    expect(counts('SELECT COUNT(*) AS n FROM liabilities')).toBe(3);
    expect(counts('SELECT COUNT(*) AS n FROM recurring_transactions')).toBe(3);
    expect(counts('SELECT COUNT(*) AS n FROM snapshots')).toBe(2191); // 6 years daily
    expect(counts('SELECT COUNT(*) AS n FROM asset_valuations')).toBeGreaterThan(500);
    // precious metals entry with a metal sub-selection
    const gold = db.prepare("SELECT metal FROM assets WHERE category = 'precious_metals'").get() as
      { metal: string };
    expect(gold.metal).toBe('gold');

    // Today's snapshot must equal the sum of latest valuations.
    const snap = db
      .prepare("SELECT * FROM snapshots WHERE snapshot_date = '2026-06-11'")
      .get() as { assets_minor: number; liabilities_minor: number; net_worth_minor: number };
    expect(snap.net_worth_minor).toBe(snap.assets_minor - snap.liabilities_minor);
    expect(snap.assets_minor).toBeGreaterThan(0);
    expect(snap.liabilities_minor).toBeGreaterThan(0);

    // Recurring schedules start in the future (seeded values are current).
    const overdue = db
      .prepare("SELECT COUNT(*) AS n FROM recurring_transactions WHERE next_run_on <= '2026-06-11'")
      .get() as { n: number };
    expect(overdue.n).toBe(0);
  });

  it('is repeatable (resets the demo account)', () => {
    const db = freshDb();
    const now = () => new Date('2026-06-11T10:00:00Z');
    seed(db, now);
    seed(db, now);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'demo'").get() as { n: number }).n;
    expect(n).toBe(1);
    const assets = (db.prepare('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n;
    expect(assets).toBe(8);
  });
});

function insertUser(db: DatabaseSync): number {
  return db
    .prepare("INSERT INTO users (username, password_hash, display_name) VALUES ('u1', 'x', 'U')")
    .run().lastInsertRowid as number;
}

function insertAsset(db: DatabaseSync, userId: number): number {
  return db
    .prepare("INSERT INTO assets (user_id, category, name) VALUES (?, 'cash', 'Cash')")
    .run(userId).lastInsertRowid as number;
}
