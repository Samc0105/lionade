-- Migration 038: Remove the signup bonus.
--
-- New users used to start with 100 Fangs handed to them via the
-- handle_new_user() trigger. We're moving that "first reward" moment
-- into the daily Clock In claim — the user has to actively tap the gold
-- navbar pill to earn their first Fangs (10F base tier). This makes the
-- onboarding-to-engagement loop start with a deliberate action instead
-- of a passive deposit.
--
-- Existing users who already received the 100F at signup keep their
-- balance — this only affects new signups going forward.

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
    0,    -- start at 0 Fangs — first reward is the daily Clock In claim
    0, 1, 0, 1000, FALSE
  )
  ON CONFLICT (id) DO NOTHING;

  -- No coin_transactions row inserted: there's no signup bonus to log.

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
