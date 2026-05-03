-- Migration 046: Daily Spin wheel.
--
-- One spin per 24h, server-rolled, never client-decided. Stores the full
-- outcome record so we can audit, run analytics, and reverse a spin if
-- a bug ever lets a bad outcome slip through.
--
-- Schema notes:
--   - balance_before / balance_after let us reconstruct exact accounting
--     even if profile.coins drifts due to other concurrent ops.
--   - reward_payload is JSONB for booster ids, cosmetic ids, etc.
--   - 'tax_man' and 'bust' allow negative fangs_delta; everything else is
--     positive or zero.
--   - The 24h cooldown is enforced at the API layer by querying
--     max(spun_at), not by a DB unique constraint — a unique constraint
--     would block legitimate retries on transient failures.
--
-- We also extend coin_transactions.type to include 'daily_spin' so the
-- audit log can track spin-driven Fang movements alongside everything else.

-- ─── daily_spins table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_spins (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  spun_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome             TEXT NOT NULL CHECK (outcome IN (
    'small_fangs','bust','medium_fangs','booster',
    'big_fangs','mega_fangs','streak_shield','rare_cosmetic',
    'tax_man','jackpot'
  )),
  fangs_delta         INTEGER NOT NULL,                  -- can be negative (bust, tax_man)
  reward_payload      JSONB,                             -- booster id, cosmetic id, etc.
  balance_before      INTEGER NOT NULL,
  balance_after       INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "what was this user's most recent spin?" (cooldown check + history widget)
CREATE INDEX IF NOT EXISTS daily_spins_user_spun_idx
  ON daily_spins (user_id, spun_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE daily_spins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_spins_owner ON daily_spins;
CREATE POLICY daily_spins_owner ON daily_spins
  FOR ALL USING (auth.uid() = user_id);

-- ─── Extend coin_transactions.type ──────────────────────────────────────────
-- Add 'daily_spin' to the enum so spin-driven Fang movements appear in the
-- audit log with their own type. Drops + recreates the constraint.
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
      'exam_session', 'mastery_session', 'login_bonus', 'daily_drill',
      'focus_session', 'streak_revive', 'daily_spin'
    ));
END $$;
