-- Migration 043: Revert the custom layered avatar system back to DiceBear.
--
-- Drops the columns added in 041 and removes 'avatar_unlock' from the
-- coin_transactions type check. The DiceBear URL stored in
-- profiles.avatar_url remains the source of truth, as it was pre-041.

ALTER TABLE profiles DROP COLUMN IF EXISTS avatar_config;
ALTER TABLE profiles DROP COLUMN IF EXISTS unlocked_avatar_items;

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
      'exam_session', 'mastery_session', 'login_bonus',
      'daily_drill', 'focus_session', 'streak_revive'
    ));
END $$;
