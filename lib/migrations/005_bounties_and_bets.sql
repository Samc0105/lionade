-- ============================================================
-- Migration 005: Bounty Board + Daily Bets
-- Run in Supabase SQL Editor.
-- ============================================================

-- Bounty Board: rotating challenges with rewards
CREATE TABLE IF NOT EXISTS bounties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('daily', 'weekly')),
  requirement_type TEXT NOT NULL,
  requirement_value INTEGER NOT NULL,
  requirement_subject TEXT,
  requirement_difficulty TEXT,
  coin_reward INTEGER NOT NULL DEFAULT 0,
  xp_reward INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track which users completed which bounties
CREATE TABLE IF NOT EXISTS user_bounties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bounty_id UUID NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  progress INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  claimed BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, bounty_id)
);

-- Daily Bets: stake coins on your performance
CREATE TABLE IF NOT EXISTS daily_bets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coins_staked INTEGER NOT NULL,
  target_score INTEGER NOT NULL,
  target_total INTEGER NOT NULL DEFAULT 10,
  subject TEXT,
  actual_score INTEGER,
  won BOOLEAN,
  coins_won INTEGER DEFAULT 0,
  placed_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_bounties_user ON user_bounties(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_bets_user ON daily_bets(user_id);

-- RLS
ALTER TABLE bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_bets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bounties_readable" ON bounties;
CREATE POLICY "bounties_readable" ON bounties FOR SELECT USING (true);
DROP POLICY IF EXISTS "user_bounties_owner" ON user_bounties;
CREATE POLICY "user_bounties_owner" ON user_bounties FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "daily_bets_owner" ON daily_bets;
CREATE POLICY "daily_bets_owner" ON daily_bets FOR ALL USING (auth.uid() = user_id);

-- Seed some starter bounties
INSERT INTO bounties (title, description, type, requirement_type, requirement_value, requirement_subject, requirement_difficulty, coin_reward, xp_reward) VALUES
('Sharpshooter', 'Score 9/10 or higher on any quiz', 'daily', 'min_score', 9, NULL, NULL, 25, 50),
('Math Grind', 'Complete 3 Math quizzes today', 'daily', 'quiz_count', 3, 'math', NULL, 20, 40),
('Perfect Run', 'Get a perfect 10/10 on any quiz', 'daily', 'perfect_score', 1, NULL, NULL, 50, 100),
('Speed Demon', 'Complete a Blitz mode quiz with 7+ correct', 'daily', 'blitz_score', 7, NULL, NULL, 35, 70),
('No Fear', 'Complete an Advanced difficulty quiz', 'daily', 'advanced_quiz', 1, NULL, NULL, 30, 60),
('Weekly Warrior', 'Complete 20 quizzes this week', 'weekly', 'quiz_count', 20, NULL, NULL, 100, 200),
('Coin Hunter', 'Earn 200 coins this week', 'weekly', 'coins_earned', 200, NULL, NULL, 75, 150),
('Streak Master', 'Maintain a 7-day streak', 'weekly', 'streak', 7, NULL, NULL, 150, 300);

SELECT 'bounties and bets tables ready' AS status;
