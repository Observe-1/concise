-- Lets a holding stay tracked (still listed, still valued) while being left
-- out of every summed total: net worth, dashboard summary, snapshots/history,
-- predictions, household combined totals, goal progress.

ALTER TABLE assets ADD COLUMN exclude_from_totals INTEGER NOT NULL DEFAULT 0
  CHECK (exclude_from_totals IN (0, 1));
ALTER TABLE liabilities ADD COLUMN exclude_from_totals INTEGER NOT NULL DEFAULT 0
  CHECK (exclude_from_totals IN (0, 1));
