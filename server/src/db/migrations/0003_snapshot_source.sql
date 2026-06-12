-- Distinguishes computed daily snapshots from user-entered legacy wealth
-- points ("on X date my net worth was Y"). Legacy rows are never overwritten
-- by snapshot recomputation.

ALTER TABLE snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'computed'
  CHECK (source IN ('computed', 'legacy'));
