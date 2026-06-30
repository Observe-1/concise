-- Net worth goals: a user-set target net worth (with an optional deadline)
-- tracked against the portfolio's actual totals.

CREATE TABLE goals (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  target_minor INTEGER NOT NULL CHECK (target_minor > 0),
  target_date  TEXT,  -- optional YYYY-MM-DD, user-set deadline
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_goals_user ON goals(user_id);
