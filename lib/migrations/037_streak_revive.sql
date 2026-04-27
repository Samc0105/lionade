-- Migration 037: Streak Revive — replaces the pre-emptive Streak Shield
-- mechanic with a Snapchat-style post-hoc recovery window.
--
-- HOW IT WORKS:
--   1. User's streak expires (lib/hooks `resetExpiredStreak`).
--   2. Instead of just zeroing the streak, we open a `streak_revives` row
--      with `previous_streak`, `expires_at = now + 24h`, status='open'.
--   3. UI surfaces a countdown banner. User can spend 5K Fangs OR $0.99
--      to restore the previous streak (and bump last_activity_at).
--   4. If 24h passes without claim, status flips to 'expired' (lazy on
--      next read — no cron needed).
--   5. Users can NEVER stockpile. There is at most one open revive per
--      user, and a new one only opens when a streak breaks.
--
-- The old `streak_shields` table from migration 034 is dropped — that
-- pre-emptive model was scrapped.

DROP TABLE IF EXISTS streak_shields;

CREATE TABLE IF NOT EXISTS streak_revives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Snapshot of what the user had before the reset, so we can restore it.
  previous_streak INTEGER NOT NULL,

  -- Lifecycle.
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'claimed', 'expired')),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,

  -- Payment audit.
  claim_method TEXT
    CHECK (claim_method IN ('fangs', 'cash', 'pro_monthly', 'platinum_monthly', 'gift', 'admin')),
  fangs_spent  INTEGER NOT NULL DEFAULT 0,
  cash_cents   INTEGER NOT NULL DEFAULT 0
);

-- Only one OPEN revive per user at a time. Constraint enforces this.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_streak_revives_one_open_per_user
  ON streak_revives(user_id) WHERE status = 'open';

-- Hot path: "do I have an open revive?" lookup.
CREATE INDEX IF NOT EXISTS idx_streak_revives_user_status_expires
  ON streak_revives(user_id, status, expires_at);

ALTER TABLE streak_revives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "streak_revives_select_own"
  ON streak_revives FOR SELECT USING (auth.uid() = user_id);
-- Writes via supabaseAdmin only (server-side claim flow).

-- Reuse the coin_transactions type list — drop fang_shield, add streak_revive.
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
