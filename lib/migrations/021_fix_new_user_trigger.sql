-- Migration 021: Fix handle_new_user trigger for new signups
--
-- The trigger was failing because it didn't include all required columns.
-- This version includes all columns that have NOT NULL constraints.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (
    id, username, display_name, avatar_url,
    coins, xp, level, streak,
    arena_elo, onboarding_completed
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'https://api.dicebear.com/7.x/avataaars/svg?seed=' || encode(NEW.id::text::bytea, 'base64') || '&backgroundColor=4A90D9',
    100,    -- signup bonus coins
    0,      -- starting XP
    1,      -- starting level
    0,      -- starting streak
    1000,   -- starting ELO
    FALSE   -- onboarding not yet completed
  )
  ON CONFLICT (id) DO NOTHING;

  -- Log signup bonus (ignore if duplicate)
  INSERT INTO coin_transactions (user_id, amount, type, description)
  VALUES (NEW.id, 100, 'signup_bonus', 'Welcome to Lionade!')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth.users INSERT — log and continue
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
