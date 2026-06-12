-- Backdated market-valued assets backfill one valuation per day from the
-- provider. When the provider has no price for part of that range the gap is
-- recorded here so the UI can flag the entry as historically incomplete.

ALTER TABLE assets ADD COLUMN history_price_missing INTEGER NOT NULL DEFAULT 0
  CHECK (history_price_missing IN (0, 1));
