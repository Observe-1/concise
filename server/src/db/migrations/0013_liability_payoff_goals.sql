-- Adds a second goal type: paying off a specific liability (vs. reaching a
-- net worth target). SQLite cannot modify CHECK constraints, so the table is
-- rebuilt (same pattern as 0007/0008).

CREATE TABLE goals_new (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  goal_type      TEXT NOT NULL DEFAULT 'net_worth' CHECK (goal_type IN ('net_worth', 'liability_payoff')),
  target_minor   INTEGER NOT NULL CHECK (target_minor >= 0),
  liability_id   INTEGER REFERENCES liabilities(id) ON DELETE CASCADE,
  baseline_minor INTEGER,
  target_date    TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (goal_type = 'net_worth'        AND target_minor > 0 AND liability_id IS NULL     AND baseline_minor IS NULL) OR
    (goal_type = 'liability_payoff' AND target_minor = 0 AND liability_id IS NOT NULL AND baseline_minor IS NOT NULL)
  )
);

INSERT INTO goals_new (id, user_id, name, goal_type, target_minor, target_date, notes, created_at)
  SELECT id, user_id, name, 'net_worth', target_minor, target_date, notes, created_at FROM goals;

DROP TABLE goals;
ALTER TABLE goals_new RENAME TO goals;
CREATE INDEX idx_goals_user ON goals(user_id);
