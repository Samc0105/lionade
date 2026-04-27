-- Migration 040: Repoint legacy `public.users` foreign keys to `profiles(id)`.
--
-- BUG DISCOVERED: `coin_transactions.user_id` and `daily_activity.user_id`
-- both FK'd to `public.users(id)` — a legacy table that has been empty
-- (0 rows) for the entire history of the app. Every INSERT into either
-- table has been silently failing the FK check. Symptoms:
--   * Clock In (daily login bonus) returns 500 "Couldn't log claim."
--   * Coin earn audit trail is empty (login_bonus, quiz_reward, etc all
--     failed to log even though the profile.coins balance was updated).
--   * Lifetime stats and activity history were under-reporting.
--
-- The app has always treated `profiles.id` as the user identity, and
-- `profiles.id` mirrors `auth.users.id`. Repointing the FK aligns the
-- schema with that reality and unblocks all writes immediately.

-- Drop the broken FK on coin_transactions and add the correct one.
ALTER TABLE coin_transactions
  DROP CONSTRAINT IF EXISTS coin_transactions_user_id_fkey;

ALTER TABLE coin_transactions
  ADD CONSTRAINT coin_transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Same for daily_activity.
ALTER TABLE daily_activity
  DROP CONSTRAINT IF EXISTS daily_activity_user_id_fkey;

ALTER TABLE daily_activity
  ADD CONSTRAINT daily_activity_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
