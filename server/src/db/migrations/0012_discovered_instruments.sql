-- Funds resolved dynamically by ISIN (no ordinary exchange ticker) are cached
-- here so repeat lookups by any user don't re-hit the price provider's search
-- endpoint, and so the in-memory price-provider registry can be restored
-- after a restart. Global, like the static ticker table is for known tickers.

CREATE TABLE discovered_instruments (
  symbol        TEXT PRIMARY KEY,  -- provider-native code, e.g. '0P00018XAR.L'
  isin          TEXT NOT NULL,
  name          TEXT NOT NULL,
  currency      TEXT NOT NULL,
  exchange      TEXT NOT NULL,
  discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_discovered_isin ON discovered_instruments(isin);
