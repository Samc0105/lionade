-- ============================================================
-- Migration: Add onboarding columns to profiles
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Add new columns (safe to re-run — IF NOT EXISTS via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'goal_type') THEN
    ALTER TABLE profiles ADD COLUMN goal_type TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'selected_subjects') THEN
    ALTER TABLE profiles ADD COLUMN selected_subjects JSONB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'daily_target') THEN
    ALTER TABLE profiles ADD COLUMN daily_target INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'onboarding_completed') THEN
    ALTER TABLE profiles ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END
$$;

-- Update the auto-create profile trigger to include onboarding_completed = false
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, display_name, avatar_url, coins, onboarding_completed)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'https://api.dicebear.com/7.x/avataaars/svg?seed=' || encode(NEW.id::text::bytea, 'base64') || '&backgroundColor=4A90D9',
    100,   -- signup bonus coins
    FALSE  -- onboarding not yet completed
  );

  -- Log signup bonus
  INSERT INTO coin_transactions (user_id, amount, type, description)
  VALUES (NEW.id, 100, 'signup_bonus', 'Welcome to Lionade! 🎉');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
