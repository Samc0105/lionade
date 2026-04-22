-- Migration 025: Daily Missions System
--
-- Tracks per-user progress on 3 daily missions.
-- Mission templates live in code (lib/missions.ts), not the DB.
-- Rotation is deterministic (seeded by date), same for all users.

CREATE TABLE IF NOT EXISTS user_daily_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mission_date DATE NOT NULL DEFAULT CURRENT_DATE,
  mission_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  UNIQUE(user_id, mission_date, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_missions_lookup
  ON user_daily_missions(user_id, mission_date);

CREATE INDEX IF NOT EXISTS idx_user_daily_missions_unclaimed
  ON user_daily_missions(user_id, claimed)
  WHERE claimed = FALSE AND completed = TRUE;

ALTER TABLE user_daily_missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_daily_missions_select"
  ON user_daily_missions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_daily_missions_insert"
  ON user_daily_missions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_daily_missions_update"
  ON user_daily_missions FOR UPDATE
  USING (auth.uid() = user_id);
