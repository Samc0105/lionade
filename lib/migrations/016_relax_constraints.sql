-- Migration 016: Relax CHECK constraints that were silently breaking inserts
-- Run this in the Supabase SQL editor.
--
-- Two issues:
--
-- 1) coin_transactions.type CHECK only allows the original 6 values
--    (quiz_reward, duel_win, duel_loss, streak_bonus, badge_bonus, signup_bonus)
--    but the app now writes many more types: ninny_session, ninny_unlock,
--    ninny_refund, shop_purchase, bet_placed, bet_won, bounty_reward, game_reward.
--    These inserts were failing silently (wrapped in non-fatal try/catch),
--    leaving the audit log incomplete while user-visible Fang totals were
--    still updated via the separate profiles.coins UPDATE.
--    Fix: drop the CHECK entirely. The app is the source of truth for
--    valid transaction types — adding new ones shouldn't require a migration.
--
-- 2) arena_matches.status CHECK only allows ('pending','active','completed','cancelled')
--    but PR 2 added a 'completing' intermediate state used by the atomic claim
--    that closes the double-pay race window in /api/arena/complete.
--    Without this fix, the atomic conditional update fails and the race
--    is still open.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Drop CHECK on coin_transactions.type
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE coin_transactions DROP CONSTRAINT IF EXISTS coin_transactions_type_check;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Update arena_matches.status CHECK to include 'completing'
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE arena_matches DROP CONSTRAINT IF EXISTS arena_matches_status_check;
ALTER TABLE arena_matches
  ADD CONSTRAINT arena_matches_status_check
  CHECK (status IN ('pending', 'active', 'completing', 'completed', 'cancelled'));

-- ──────────────────────────────────────────────────────────────────────
-- Verify (run these manually in the SQL editor to confirm)
-- ──────────────────────────────────────────────────────────────────────
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'coin_transactions'::regclass;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'arena_matches'::regclass;
