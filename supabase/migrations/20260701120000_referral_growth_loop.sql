-- Migration: Referral growth loop
--
-- HELD — Sam applies manually. The web code fails soft until this runs:
--   * GET  /api/referral/me      -> returns { enabled:false } if profiles.referral_code missing
--   * POST /api/referral/claim   -> no-ops (200, claimed:false) if referrals table missing
--   * save-quiz-results reward   -> wrapped in try/catch, never blocks the quiz save
--
-- Anti-abuse design lives in the schema itself:
--   * profiles.referral_code UNIQUE            — one shareable code per user, collision-safe
--   * referrals UNIQUE(referee_id)             — a user can be referred ONCE, ever (the core guard)
--   * status flip pending -> rewarded is the   — the idempotency latch for the double-grant guard
--     single source of truth; the reward path
--     only credits on the pending -> rewarded
--     transition (see reward_referral()).
--   * CHECK (referrer_id <> referee_id)        — DB-level self-referral rejection (belt + braces;
--                                                 the API also rejects it)

-- ─── 1. Per-user shareable code ─────────────────────────────
-- Nullable so existing rows don't need backfill in the same statement; the API
-- lazily assigns a code the first time a user views their referral panel.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- UNIQUE via a partial index (skips NULLs) so un-assigned users don't collide
-- on a single NULL. Case-insensitive-safe because we only ever store uppercase.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON profiles (referral_code)
  WHERE referral_code IS NOT NULL;

-- ─── 2. Referral edges ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'rewarded')),
  reward_fangs INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at  TIMESTAMPTZ,
  -- Core anti-abuse: a given user can only ever be on the RECEIVING end of one
  -- referral. Re-referral (a second code claim) hits this and is rejected.
  CONSTRAINT referrals_referee_unique UNIQUE (referee_id),
  -- Self-referral is impossible at the DB layer too.
  CONSTRAINT referrals_no_self CHECK (referrer_id <> referee_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx   ON referrals (status);

-- ─── 3. RLS ─────────────────────────────────────────────────
-- All writes go through the service-role API (supabaseAdmin), which bypasses
-- RLS. We still enable RLS + a read policy so a user can see rows they are part
-- of if the client ever queries directly. No client INSERT/UPDATE policy: the
-- economy is server-authoritative.
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referrals_select_own ON referrals;
CREATE POLICY referrals_select_own ON referrals
  FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

-- ─── 4. Atomic reward latch ─────────────────────────────────
-- Flips exactly one pending row to rewarded and returns it. Because the UPDATE
-- targets a specific referee_id AND requires status='pending', two concurrent
-- callers race on the same row and only ONE gets a returned row (row lock +
-- the status predicate). The loser gets zero rows -> no double reward. The
-- actual Fang grants are done by the caller via update_user_coins so the grant
-- shares the app's single atomic money primitive.
CREATE OR REPLACE FUNCTION reward_referral(p_referee_id UUID)
RETURNS TABLE (referrer_id UUID, referee_id UUID, code TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE referrals r
     SET status = 'rewarded',
         rewarded_at = now()
   WHERE r.referee_id = p_referee_id
     AND r.status = 'pending'
  RETURNING r.referrer_id, r.referee_id, r.code;
$$;

REVOKE ALL ON FUNCTION reward_referral(UUID) FROM PUBLIC;
-- Only the service role invokes this (from the server). No anon/authenticated grant.

-- ─── 5. Ledger audit types ──────────────────────────────────
-- The referral grants write coin_transactions rows of type 'referral_reward'
-- (referrer) and 'referral_bonus' (referee). coin_transactions has a CHECK
-- allowlist (migration 20260618130000) that rejects unknown types, so without
-- this the audit insert would 23514 and the balance would move with NO ledger
-- trail, breaking dual-ledger reconciliation. Recreate the CHECK with the full
-- current list plus the two referral types (mirrors 20260618130000's pattern).
ALTER TABLE coin_transactions DROP CONSTRAINT IF EXISTS coin_transactions_type_check;
ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_type_check CHECK (
  type IN (
    'admin_adjustment','arena_loss','arena_win','badge_bonus','bet_placed','bet_won',
    'bounty_reward','bounty_stake','competitive_match','daily_bonus','daily_drill',
    'daily_spin','duel_loss','duel_win','exam_session','fang_iap_purchase',
    'fang_iap_refund','focus_session','founder_badge_grant','game_reward','login_bonus',
    'mastery_session','mission_reward','ninny_abandon','ninny_refund','ninny_session',
    'ninny_unlock','quiz_reward','reward','shop_purchase','shop_refund','signup_bonus',
    'streak_bonus','streak_milestone','streak_revive','vocab_clone','vocab_review','vocab_save',
    'referral_reward','referral_bonus'
  )
);
