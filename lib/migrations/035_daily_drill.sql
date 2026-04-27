-- Migration 035: Daily Drill — the daily 5-question retention ritual.
--
-- Tracks per-user, per-day completion of the Daily Drill so it can't
-- be re-claimed within the same UTC day. The drill itself pulls
-- questions from mastery_events (rows where was_correct=false) — no
-- new content storage required, just the completion record.

CREATE TABLE IF NOT EXISTS daily_drill_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  drill_date DATE NOT NULL,

  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  coins_earned INTEGER NOT NULL DEFAULT 0,

  -- Audit trail of which questions were served (helps with future
  -- spaced-rep tuning).
  question_ids UUID[] NOT NULL DEFAULT '{}',

  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, drill_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_drill_user_date
  ON daily_drill_completions(user_id, drill_date DESC);

ALTER TABLE daily_drill_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_drill_select_own"
  ON daily_drill_completions FOR SELECT USING (auth.uid() = user_id);
-- Writes via supabaseAdmin only.

-- Allow the new transaction type.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'coin_transactions' AND constraint_name = 'coin_transactions_type_check'
  ) THEN
    ALTER TABLE coin_transactions DROP CONSTRAINT coin_transactions_type_check;
  END IF;
  ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_type_check
    CHECK (type IN (
      'signup_bonus', 'quiz_reward', 'duel_win', 'duel_loss', 'streak_bonus',
      'streak_milestone', 'bounty_reward', 'bounty_stake', 'badge_bonus',
      'game_reward', 'ninny_session', 'ninny_unlock', 'shop_purchase',
      'shop_refund', 'daily_bonus', 'arena_win', 'arena_loss', 'mission_reward',
      'exam_session', 'mastery_session', 'login_bonus', 'fang_shield',
      'daily_drill', 'focus_session'
    ));
END $$;
