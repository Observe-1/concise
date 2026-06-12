-- Adds the vehicle depreciation valuation method: vehicle assets may
-- auto-apply average age-based depreciation from their manufacture date.
-- SQLite cannot modify CHECK constraints, so the assets table is rebuilt.

CREATE TABLE assets_new (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       TEXT NOT NULL CHECK (category IN
                   ('cash','investments','property','vehicles','crypto','precious_metals','other')),
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  notes          TEXT,
  metal          TEXT CHECK (metal IN ('gold','silver','platinum','palladium')),
  valuation_mode TEXT NOT NULL DEFAULT 'manual'
                   CHECK (valuation_mode IN ('manual','market','property_index','depreciation')),
  market_symbol  TEXT,
  quantity       REAL,
  country        TEXT CHECK (length(country) = 2),
  manufacture_date TEXT,
  history_price_missing INTEGER NOT NULL DEFAULT 0 CHECK (history_price_missing IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (valuation_mode != 'market' OR (market_symbol IS NOT NULL AND quantity IS NOT NULL AND quantity > 0)),
  CHECK (metal IS NULL OR category = 'precious_metals'),
  CHECK (valuation_mode != 'property_index' OR (country IS NOT NULL AND category = 'property')),
  CHECK (country IS NULL OR valuation_mode = 'property_index'),
  CHECK (valuation_mode != 'depreciation' OR (manufacture_date IS NOT NULL AND category = 'vehicles')),
  CHECK (manufacture_date IS NULL OR valuation_mode = 'depreciation')
);

INSERT INTO assets_new (id, user_id, category, name, notes, metal, valuation_mode,
                        market_symbol, quantity, country, manufacture_date,
                        history_price_missing, created_at, updated_at)
SELECT id, user_id, category, name, notes, metal, valuation_mode,
       market_symbol, quantity, country, NULL, history_price_missing, created_at, updated_at
FROM assets;

DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;
CREATE INDEX idx_assets_user ON assets(user_id);
