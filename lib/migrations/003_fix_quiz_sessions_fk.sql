-- ============================================================
-- Migration 003: Fix quiz_sessions foreign key
-- The quiz_sessions table has a FK that doesn't match the
-- actual profiles table. Drop and recreate (table is empty).
-- Run in Supabase SQL Editor.
-- ============================================================

-- Drop dependents first
DROP TABLE IF EXISTS user_answers CASCADE;
DROP TABLE IF EXISTS quiz_sessions CASCADE;

-- Recreate quiz_sessions with correct FK to profiles
CREATE TABLE quiz_sessions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  score            INTEGER NOT NULL DEFAULT 0,
  total_questions  INTEGER NOT NULL DEFAULT 0,
  correct_answers  INTEGER NOT NULL DEFAULT 0,
  coins_earned     INTEGER NOT NULL DEFAULT 0,
  xp_earned        INTEGER NOT NULL DEFAULT 0,
  streak_bonus     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recreate user_answers
CREATE TABLE user_answers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions(id),
  selected_answer INTEGER,
  is_correct      BOOLEAN NOT NULL DEFAULT FALSE,
  time_left       INTEGER NOT NULL DEFAULT 0,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_quiz_sessions_user_id ON quiz_sessions(user_id);
CREATE INDEX idx_quiz_sessions_completed_at ON quiz_sessions(completed_at DESC);
CREATE INDEX idx_user_answers_session_id ON user_answers(session_id);

-- RLS
ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_answers ENABLE ROW LEVEL SECURITY;

-- Policies: service role bypasses these, but needed for client reads
CREATE POLICY "quiz_sessions_owner" ON quiz_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_answers_owner" ON user_answers FOR ALL USING (
  session_id IN (SELECT id FROM quiz_sessions WHERE user_id = auth.uid())
);

-- Verify
SELECT 'quiz_sessions created' AS status;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'quiz_sessions' ORDER BY ordinal_position;
