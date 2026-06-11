-- Concise initial schema.
-- Money columns are integer minor units (cents/pence). Dates are ISO-8601 TEXT.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE settings (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3)
);

CREATE TABLE assets (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       TEXT NOT NULL CHECK (category IN
                   ('cash','investments','property','vehicles','crypto','other')),
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  notes          TEXT,
  valuation_mode TEXT NOT NULL DEFAULT 'manual' CHECK (valuation_mode IN ('manual','market')),
  market_symbol  TEXT,
  quantity       REAL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (valuation_mode != 'market' OR (market_symbol IS NOT NULL AND quantity IS NOT NULL AND quantity > 0))
);
CREATE INDEX idx_assets_user ON assets(user_id);

CREATE TABLE asset_valuations (
  id          INTEGER PRIMARY KEY,
  asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  value_minor INTEGER NOT NULL CHECK (value_minor >= 0),
  source      TEXT NOT NULL CHECK (source IN ('manual','recurring','market','seed')),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_asset_valuations_asset ON asset_valuations(asset_id, recorded_at DESC);

CREATE TABLE liabilities (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN
               ('mortgage','loan','credit_card','student_loan','other')),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_liabilities_user ON liabilities(user_id);

CREATE TABLE liability_valuations (
  id           INTEGER PRIMARY KEY,
  liability_id INTEGER NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  value_minor  INTEGER NOT NULL CHECK (value_minor >= 0),
  source       TEXT NOT NULL CHECK (source IN ('manual','recurring','market','seed')),
  recorded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_liability_valuations_liability
  ON liability_valuations(liability_id, recorded_at DESC);

CREATE TABLE recurring_transactions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  asset_id     INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  liability_id INTEGER REFERENCES liabilities(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor != 0),
  cadence      TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly','yearly')),
  next_run_on  TEXT NOT NULL,  -- YYYY-MM-DD cursor
  last_run_on  TEXT,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((asset_id IS NULL) != (liability_id IS NULL))  -- exactly one target
);
CREATE INDEX idx_recurring_due ON recurring_transactions(active, next_run_on);
CREATE INDEX idx_recurring_user ON recurring_transactions(user_id);

CREATE TABLE snapshots (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date     TEXT NOT NULL,  -- YYYY-MM-DD
  assets_minor      INTEGER NOT NULL,
  liabilities_minor INTEGER NOT NULL,
  net_worth_minor   INTEGER NOT NULL,
  UNIQUE (user_id, snapshot_date)
);
CREATE INDEX idx_snapshots_user_date ON snapshots(user_id, snapshot_date);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);
