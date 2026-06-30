-- Per-goal toggle: whether the goal is drawn as a gold marker line on the
-- dashboard's prediction graph (at its projected ETA). Defaults to on, so
-- existing goals show up without any user action. No CHECK-constraint change,
-- so a plain ADD COLUMN is enough (no table rebuild).

ALTER TABLE goals ADD COLUMN show_on_prediction INTEGER NOT NULL DEFAULT 1
  CHECK (show_on_prediction IN (0, 1));
