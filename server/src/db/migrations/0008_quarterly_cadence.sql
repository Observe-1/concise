-- Adds the quarterly cadence to recurring transactions. SQLite cannot modify
-- CHECK constraints, so the table is rebuilt.

CREATE TABLE recurring_transactions_new (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  asset_id     INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  liability_id INTEGER REFERENCES liabilities(id) ON DELETE CASCADE,
  amount_type  TEXT NOT NULL DEFAULT 'fixed' CHECK (amount_type IN ('fixed','percent')),
  amount_minor INTEGER,
  percent      REAL,
  cadence      TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly','quarterly','yearly')),
  next_run_on  TEXT NOT NULL,  -- YYYY-MM-DD cursor
  last_run_on  TEXT,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((asset_id IS NULL) != (liability_id IS NULL)),  -- exactly one target
  CHECK (
    (amount_type = 'fixed'   AND amount_minor IS NOT NULL AND amount_minor != 0 AND percent IS NULL) OR
    (amount_type = 'percent' AND percent IS NOT NULL AND percent != 0 AND amount_minor IS NULL)
  )
);

INSERT INTO recurring_transactions_new
SELECT * FROM recurring_transactions;

DROP TABLE recurring_transactions;
ALTER TABLE recurring_transactions_new RENAME TO recurring_transactions;
CREATE INDEX idx_recurring_due ON recurring_transactions(active, next_run_on);
CREATE INDEX idx_recurring_user ON recurring_transactions(user_id);
