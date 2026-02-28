-- ============================================================
-- Migration 002: Add missing gamification columns
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── Profiles: add coins, xp, streak, level ──────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS max_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;

-- Give all existing users their signup bonus (100 coins)
UPDATE profiles SET coins = 100 WHERE coins = 0;

-- ── Quiz Sessions: add missing result columns ───────────────
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS total_questions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS correct_answers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS xp_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS streak_bonus BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Daily Activity: add streak tracking ─────────────────────
ALTER TABLE daily_activity ADD COLUMN IF NOT EXISTS streak_maintained BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Coin Transactions: add metadata columns ─────────────────
ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE coin_transactions ADD COLUMN IF NOT EXISTS description TEXT;

-- ── User Answers: create table ──────────────────────────────
CREATE TABLE IF NOT EXISTS user_answers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions(id),
  selected_answer INTEGER,
  is_correct      BOOLEAN NOT NULL DEFAULT FALSE,
  time_left       INTEGER NOT NULL DEFAULT 0,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_answers_session_id ON user_answers(session_id);

-- RLS for user_answers
ALTER TABLE user_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_answers_owner" ON user_answers;
CREATE POLICY "user_answers_owner" ON user_answers FOR ALL USING (
  session_id IN (SELECT id FROM quiz_sessions WHERE user_id = auth.uid())
);

-- ── Indexes for new columns ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_coins ON profiles(coins DESC);

-- ── Level trigger: auto-update level when xp changes ────────
CREATE OR REPLACE FUNCTION update_level()
RETURNS TRIGGER AS $$
BEGIN
  NEW.level := GREATEST(1, FLOOR(NEW.xp / 1000) + 1);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to avoid conflict, then create
DROP TRIGGER IF EXISTS on_profile_xp_change ON profiles;
CREATE TRIGGER on_profile_xp_change
  BEFORE UPDATE OF xp ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_level();

-- ============================================================
-- Verify: run these to confirm columns were added
-- ============================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'quiz_sessions' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'user_answers' ORDER BY ordinal_position;
