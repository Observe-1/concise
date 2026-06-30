-- Pairwise household links: two users may mutually link to share a combined
-- net-worth view (totals only — see modules/household). At most one active
-- (pending or accepted) link exists per unordered pair, enforced by the
-- expression index below; declining/unlinking deletes the row so a pair can
-- re-invite later.

CREATE TABLE household_links (
  id           INTEGER PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  responded_at TEXT,
  CHECK (requester_id != recipient_id)
);
CREATE UNIQUE INDEX idx_household_pair
  ON household_links(MIN(requester_id, recipient_id), MAX(requester_id, recipient_id));
CREATE INDEX idx_household_recipient ON household_links(recipient_id, status);
CREATE INDEX idx_household_requester ON household_links(requester_id, status);
