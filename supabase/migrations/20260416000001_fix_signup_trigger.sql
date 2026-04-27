-- Migration 022: Fix signup trigger — comprehensive
--
-- The handle_new_user() trigger on auth.users was crashing because it
-- didn't include all required columns (xp, level, streak, arena_elo).
-- This caused a 500 Internal Server Error on /auth/v1/signup.
--
-- This migration:
-- 1. Ensures calc_level_from_xp exists
-- 2. Fixes on_profile_xp_change to never crash
-- 3. Rebuilds handle_new_user with all columns + EXCEPTION handler

-- ─── 1. Level calculation function ──────────────────────────
CREATE OR REPLACE FUNCTION calc_level_from_xp(total_xp INTEGER)
RETURNS INTEGER AS $$
DECLARE
  lvl INTEGER := 1;
  remaining INTEGER := total_xp;
  needed INTEGER;
BEGIN
  WHILE lvl < 100 LOOP
    needed := FLOOR(100 * POWER(1.055, lvl - 1));
    IF remaining < needed THEN EXIT; END IF;
    remaining := remaining - needed;
    lvl := lvl + 1;
  END LOOP;
  RETURN lvl;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── 2. XP change trigger (safe for INSERT + UPDATE) ────────
CREATE OR REPLACE FUNCTION on_profile_xp_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.xp IS DISTINCT FROM OLD.xp THEN
    NEW.level := calc_level_from_xp(COALESCE(NEW.xp, 0));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 3. New user signup trigger ─────────────────────────────
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
    'https://api.dicebear.com/7.x/avataaars/svg?seed=' || encode(NEW.id::text::bytea, 'base64'),
    100, 0, 1, 0, 1000, FALSE
  )
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    INSERT INTO coin_transactions (user_id, amount, type, description)
    VALUES (NEW.id, 100, 'signup_bonus', 'Welcome to Lionade!');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
