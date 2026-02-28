-- ============================================================
-- Migration 004: Achievements table
-- Run in Supabase SQL Editor if not already created.
-- ============================================================

CREATE TABLE IF NOT EXISTS achievements (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_key  TEXT NOT NULL,
  unlocked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON achievements(user_id);

ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "achievements_owner" ON achievements;
CREATE POLICY "achievements_owner" ON achievements FOR ALL USING (auth.uid() = user_id);

-- Verify
SELECT 'achievements table ready' AS status;
