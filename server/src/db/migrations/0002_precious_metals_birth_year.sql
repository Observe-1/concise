-- Adds the precious_metals asset class (with a metal sub-selection) and the
-- birth_year user setting. SQLite cannot modify CHECK constraints, so the
-- assets table is rebuilt (runner disables foreign_keys around migrations and
-- runs foreign_key_check afterwards).

ALTER TABLE settings ADD COLUMN birth_year INTEGER
  CHECK (birth_year IS NULL OR (birth_year BETWEEN 1900 AND 2100));

CREATE TABLE assets_new (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       TEXT NOT NULL CHECK (category IN
                   ('cash','investments','property','vehicles','crypto','precious_metals','other')),
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  notes          TEXT,
  metal          TEXT CHECK (metal IN ('gold','silver','platinum','palladium')),
  valuation_mode TEXT NOT NULL DEFAULT 'manual' CHECK (valuation_mode IN ('manual','market')),
  market_symbol  TEXT,
  quantity       REAL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (valuation_mode != 'market' OR (market_symbol IS NOT NULL AND quantity IS NOT NULL AND quantity > 0)),
  CHECK (metal IS NULL OR category = 'precious_metals')
);

INSERT INTO assets_new (id, user_id, category, name, notes, metal, valuation_mode,
                        market_symbol, quantity, created_at, updated_at)
SELECT id, user_id, category, name, notes, NULL, valuation_mode,
       market_symbol, quantity, created_at, updated_at
FROM assets;

DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;
CREATE INDEX idx_assets_user ON assets(user_id);
