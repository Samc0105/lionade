-- Migration 024: Bounty rotation system
--
-- Expands the bounty pool from 8 → 30+ bounties.
-- Adds rotation tracking columns.
-- Daily bounties rotate at midnight UTC (5 active at a time).
-- Weekly bounties rotate on Friday midnight UTC (3 active at a time).

-- ─── Add rotation columns ───────────────────────────────────
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS pool_id TEXT;
-- pool_id groups bounties: 'daily_pool' or 'weekly_pool'

-- Tag existing bounties with pool IDs
UPDATE bounties SET pool_id = type || '_pool' WHERE pool_id IS NULL;

-- ─── Rotation state table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS bounty_rotation (
  id TEXT PRIMARY KEY,             -- 'daily' or 'weekly'
  active_bounty_ids UUID[] NOT NULL DEFAULT '{}',
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_rotation TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bounty_rotation (id, active_bounty_ids, rotated_at, next_rotation)
VALUES
  ('daily', '{}', NOW(), NOW()),
  ('weekly', '{}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ─── Deactivate all current bounties (rotation will activate them) ──
UPDATE bounties SET active = false;

-- ─── EXPANDED DAILY BOUNTY POOL (20 total) ──────────────────

-- Keep existing 5
UPDATE bounties SET active = false, pool_id = 'daily_pool' WHERE type = 'daily';

-- Add 15 more daily bounties
INSERT INTO bounties (title, description, type, requirement_type, requirement_value, requirement_subject, requirement_difficulty, coin_reward, xp_reward, active, pool_id) VALUES
  ('Quick Study', 'Complete any quiz in under 3 minutes', 'daily', 'quiz_count', 1, NULL, NULL, 15, 30, false, 'daily_pool'),
  ('Science Nerd', 'Complete 2 Science quizzes today', 'daily', 'quiz_count', 2, 'Science', NULL, 20, 40, false, 'daily_pool'),
  ('History Buff', 'Complete 2 History quizzes today', 'daily', 'quiz_count', 2, 'History', NULL, 20, 40, false, 'daily_pool'),
  ('Double Down', 'Complete 2 quizzes in any subject', 'daily', 'quiz_count', 2, NULL, NULL, 15, 30, false, 'daily_pool'),
  ('Triple Threat', 'Complete 3 quizzes in any subject', 'daily', 'quiz_count', 3, NULL, NULL, 25, 50, false, 'daily_pool'),
  ('Five-a-Day', 'Complete 5 quizzes today', 'daily', 'quiz_count', 5, NULL, NULL, 40, 80, false, 'daily_pool'),
  ('Accuracy King', 'Score 8/10 or higher on any quiz', 'daily', 'min_score', 8, NULL, NULL, 20, 40, false, 'daily_pool'),
  ('Beginner Grind', 'Complete 3 Easy difficulty quizzes', 'daily', 'quiz_count', 3, NULL, 'easy', 15, 30, false, 'daily_pool'),
  ('Challenge Seeker', 'Complete 2 Hard difficulty quizzes', 'daily', 'quiz_count', 2, NULL, 'hard', 35, 70, false, 'daily_pool'),
  ('Social Studier', 'Complete 2 Social Studies quizzes', 'daily', 'quiz_count', 2, 'Social Studies', NULL, 20, 40, false, 'daily_pool'),
  ('Blitz Runner', 'Score 5+ correct in Blitz mode', 'daily', 'blitz_score', 5, NULL, NULL, 25, 50, false, 'daily_pool'),
  ('Blitz Master', 'Score 10+ correct in Blitz mode', 'daily', 'blitz_score', 10, NULL, NULL, 45, 90, false, 'daily_pool'),
  ('Coin Collector', 'Earn 50 coins today', 'daily', 'coins_earned', 50, NULL, NULL, 20, 40, false, 'daily_pool'),
  ('XP Grinder', 'Earn 100 XP today', 'daily', 'quiz_count', 4, NULL, NULL, 30, 60, false, 'daily_pool'),
  ('Mixed Bag', 'Complete quizzes in 2 different subjects', 'daily', 'quiz_count', 2, NULL, NULL, 25, 50, false, 'daily_pool')
ON CONFLICT DO NOTHING;

-- ─── EXPANDED WEEKLY BOUNTY POOL (12 total) ─────────────────

-- Keep existing 3
UPDATE bounties SET active = false, pool_id = 'weekly_pool' WHERE type = 'weekly';

-- Add 9 more weekly bounties
INSERT INTO bounties (title, description, type, requirement_type, requirement_value, requirement_subject, requirement_difficulty, coin_reward, xp_reward, active, pool_id) VALUES
  ('Quiz Machine', 'Complete 30 quizzes this week', 'weekly', 'quiz_count', 30, NULL, NULL, 150, 300, false, 'weekly_pool'),
  ('Perfectionist', 'Get 3 perfect scores this week', 'weekly', 'perfect_score', 3, NULL, NULL, 120, 240, false, 'weekly_pool'),
  ('Streak Builder', 'Maintain a 5-day streak', 'weekly', 'streak', 5, NULL, NULL, 100, 200, false, 'weekly_pool'),
  ('Big Earner', 'Earn 500 coins this week', 'weekly', 'coins_earned', 500, NULL, NULL, 125, 250, false, 'weekly_pool'),
  ('Subject Explorer', 'Complete quizzes in 3 different subjects', 'weekly', 'quiz_count', 3, NULL, NULL, 75, 150, false, 'weekly_pool'),
  ('Hard Mode Hero', 'Complete 5 Hard difficulty quizzes this week', 'weekly', 'quiz_count', 5, NULL, 'hard', 100, 200, false, 'weekly_pool'),
  ('Blitz Legend', 'Score 10+ in Blitz mode 3 times this week', 'weekly', 'blitz_score', 10, NULL, NULL, 100, 200, false, 'weekly_pool'),
  ('Daily Grinder', 'Complete at least 1 quiz every day for 5 days', 'weekly', 'streak', 5, NULL, NULL, 80, 160, false, 'weekly_pool'),
  ('Math Marathon', 'Complete 10 Math quizzes this week', 'weekly', 'quiz_count', 10, 'Math', NULL, 100, 200, false, 'weekly_pool')
ON CONFLICT DO NOTHING;
