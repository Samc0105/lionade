-- Migration 027: Nudges
--
-- A nudge is a one-tap encouragement one friend can send another
-- ("you got this", "grind time", etc.). Backed by a row in this table
-- plus a notification row for the recipient.
--
-- Rate limits enforced at the endpoint, not the DB:
--   * 5 nudges per sender per day (server tallies the day's rows)
--   * 1 per (sender, recipient) per day (blocks spam)
--
-- Retention: rows older than 7 days can be purged by a cron; nothing reads
-- historical nudges right now.

CREATE TABLE IF NOT EXISTS nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  preset TEXT NOT NULL,          -- matches the fixed preset keys in code
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup for the sender's daily count
CREATE INDEX IF NOT EXISTS idx_nudges_sender_date
  ON nudges (sender_id, created_at DESC);

-- Fast lookup to enforce "1 per pair per day"
CREATE INDEX IF NOT EXISTS idx_nudges_pair_date
  ON nudges (sender_id, recipient_id, created_at DESC);

-- RLS: rows are only touched via the server route with service-role key.
-- Clients never hit this table directly, so no policies needed — RLS on
-- with deny-all default is correct.
ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;
