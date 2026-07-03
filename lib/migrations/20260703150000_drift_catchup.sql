-- 20260703150000_drift_catchup.sql
-- ============================================================
-- Drift catch-up from the 2026-07-03 prod-schema audit
-- (docs/audits/2026-07-03-schema-drift-audit.md: 137 local migration files
-- probed against live prod; 7 never applied, 12 partial). Applied on Sam's
-- explicit go ("Do all 3"). One file so the fix set is auditable as a unit.
--
-- DELIBERATELY EXCLUDED:
--   * 038_remove_signup_bonus (new signups still get 100 Fangs) — PRODUCT
--     POLICY decision, not drift. Sam decides separately.
--   * The dropped client write-policies from 013/025/060 era files — those
--     were superseded ON PURPOSE by the 079 server-authoritative design;
--     re-adding them would reopen client writes.
--   * 20260603164500 demo user_inventory seed row — cosmetic, demo-only.
--
-- Idempotent throughout (IF NOT EXISTS / guarded DO blocks); safe to re-run.

-- ── 1) CRITICAL: founder_grants.source / reference_id ───────────────────────
-- app/api/stripe/webhook (tryGrantFoundingScholar + handleCheckoutCompleted)
-- and app/api/shop/purchase insert these on every founder-badge path; the
-- columns never existed, the insert error is swallowed, so NO founder badge
-- has ever been written by those paths. (The 20260630120000 file's header
-- claimed the columns already existed in prod — the live probe disproved it.)
ALTER TABLE public.founder_grants
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS reference_id text;

-- ── 2) learning_paths: align the live table with the code (014 shape) ───────
-- Live table diverged (has `description`, lacks `stage_description` +
-- `total_stages`) and holds ZERO rows, so getLearningPaths()'s explicit
-- column select 42703s and /learn/paths errors. Rename + add on an empty
-- table; the legacy required_score/fangs_reward/xp_reward columns are
-- nullable-with-default and unreferenced by code, kept to avoid destructive
-- churn. Content comes from scripts/seed-learning-paths.ts afterward.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='learning_paths' AND column_name='description')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='learning_paths' AND column_name='stage_description')
  THEN
    ALTER TABLE public.learning_paths RENAME COLUMN description TO stage_description;
  END IF;
END $$;

ALTER TABLE public.learning_paths
  ADD COLUMN IF NOT EXISTS stage_description text,
  ADD COLUMN IF NOT EXISTS total_stages integer;

-- 014 declares both NOT NULL; the table is empty so this is free. Guarded so
-- a re-run against a seeded table with legacy NULLs cannot brick.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.learning_paths WHERE stage_description IS NULL OR total_stages IS NULL) THEN
    ALTER TABLE public.learning_paths ALTER COLUMN stage_description SET NOT NULL;
    ALTER TABLE public.learning_paths ALTER COLUMN total_stages SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname='learning_paths_subject_stage_number_key'
                   AND conrelid='public.learning_paths'::regclass) THEN
    ALTER TABLE public.learning_paths
      ADD CONSTRAINT learning_paths_subject_stage_number_key UNIQUE (subject, stage_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_learning_paths_subject
  ON public.learning_paths(subject, stage_number);

-- ── 3) profiles.last_activity_date (010) ────────────────────────────────────
-- bumpDailyStreakCounter (mastery answer route) reads + writes it on every
-- mastery answer; the write was silently ignored, so the mastery streak-date
-- guard never worked.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_activity_date DATE;

-- ── 4) Streak Freeze (083, verbatim) ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS streak_freezes integer NOT NULL DEFAULT 0;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_freeze_consumed_date date;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_streak_freezes_nonneg;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_streak_freezes_nonneg CHECK (streak_freezes >= 0);

-- Extend the privileged-column guard (083 body = the live 080 body + the two
-- freeze columns; service_role early-returns so server writes stay allowed).
CREATE OR REPLACE FUNCTION public.guard_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.coins is distinct from old.coins
     or new.fangs_cashable is distinct from old.fangs_cashable
     or new.fangs_iap is distinct from old.fangs_iap
     or new.lifetime_fangs_spent is distinct from old.lifetime_fangs_spent
     or new.plan is distinct from old.plan
     or new.subscription_tier is distinct from old.subscription_tier
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_current_period_end is distinct from old.subscription_current_period_end
     or new.subscription_cancel_at is distinct from old.subscription_cancel_at
     or new.subscription_cycle is distinct from old.subscription_cycle
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.role is distinct from old.role
     or new.arena_elo is distinct from old.arena_elo
     or new.arena_wins is distinct from old.arena_wins
     or new.arena_losses is distinct from old.arena_losses
     or new.arena_draws is distinct from old.arena_draws
     or new.competitive_elo is distinct from old.competitive_elo
     or new.squad_elo is distinct from old.squad_elo
     or new.pending_elo_change is distinct from old.pending_elo_change
     or new.pending_wins is distinct from old.pending_wins
     or new.pending_losses is distinct from old.pending_losses
     or new.pending_draws is distinct from old.pending_draws
     or new.pending_elo_summary is distinct from old.pending_elo_summary
     or new.xp is distinct from old.xp
     or new.level is distinct from old.level
     or new.streak is distinct from old.streak
     or new.max_streak is distinct from old.max_streak
     or new.last_activity_at is distinct from old.last_activity_at
     or new.daily_questions_completed is distinct from old.daily_questions_completed
     or new.daily_reset_date is distinct from old.daily_reset_date
     -- Migration 083 additions (streak insurance):
     or new.streak_freezes is distinct from old.streak_freezes
     or new.last_freeze_consumed_date is distinct from old.last_freeze_consumed_date
  then
    raise exception 'forbidden: protected profile columns are server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ── 5) Referral growth loop (20260701120000, allowlist MERGED) ──────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON public.profiles (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referrals (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'rewarded')),
  reward_fangs INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at  TIMESTAMPTZ,
  CONSTRAINT referrals_referee_unique UNIQUE (referee_id),
  CONSTRAINT referrals_no_self CHECK (referrer_id <> referee_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx   ON public.referrals (status);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referrals_select_own ON public.referrals;
CREATE POLICY referrals_select_own ON public.referrals
  FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

CREATE OR REPLACE FUNCTION public.reward_referral(p_referee_id UUID)
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

REVOKE ALL ON FUNCTION public.reward_referral(UUID) FROM PUBLIC;

-- Ledger allowlist: the 20260701120000 file's re-statement PREDATES the
-- 20260702090000 widening applied earlier today — applying it verbatim would
-- DROP focus_room_bonus / pact_milestone / set_tip_sent / set_tip_received.
-- This is the MERGED list: today's 42 types + referral_reward + referral_bonus.
ALTER TABLE public.coin_transactions DROP CONSTRAINT IF EXISTS coin_transactions_type_check;
ALTER TABLE public.coin_transactions ADD CONSTRAINT coin_transactions_type_check
  CHECK (type = ANY (ARRAY[
    'admin_adjustment','arena_loss','arena_win','badge_bonus','bet_placed','bet_won',
    'bounty_reward','bounty_stake','competitive_match','daily_bonus','daily_drill',
    'daily_spin','duel_loss','duel_win','exam_session','fang_iap_purchase',
    'fang_iap_refund','focus_room_bonus','focus_session','founder_badge_grant',
    'game_reward','login_bonus','mastery_session','mission_reward','ninny_abandon',
    'ninny_refund','ninny_session','ninny_unlock','pact_milestone','quiz_reward',
    'referral_bonus','referral_reward','reward','set_tip_received','set_tip_sent',
    'shop_purchase','shop_refund','signup_bonus','streak_bonus','streak_milestone',
    'streak_revive','vocab_clone','vocab_review','vocab_save'
  ]::text[])) NOT VALID;
ALTER TABLE public.coin_transactions VALIDATE CONSTRAINT coin_transactions_type_check;

-- ── 6) TechHub shift completions (20260626120000, verbatim) ──────────────────
CREATE TABLE IF NOT EXISTS public.techhub_shift_completions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_id     text NOT NULL,
  best_score   int  NOT NULL DEFAULT 0 CHECK (best_score BETWEEN 0 AND 100),
  last_csat    int  NOT NULL DEFAULT 0 CHECK (last_csat BETWEEN 0 AND 100),
  plays        int  NOT NULL DEFAULT 0,
  granted_fangs int NOT NULL DEFAULT 0 CHECK (granted_fangs >= 0),
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, shift_id)
);

ALTER TABLE public.techhub_shift_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "techhub_shift_completions_owner_read" ON public.techhub_shift_completions;
CREATE POLICY "techhub_shift_completions_owner_read"
  ON public.techhub_shift_completions
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_techhub_shift_completions_user
  ON public.techhub_shift_completions(user_id);

-- ── 7) TechHub leaderboard (20260628120000, verbatim) ────────────────────────
CREATE TABLE IF NOT EXISTS public.techhub_leaderboard (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode         text NOT NULL CHECK (mode IN ('combo', 'chaos', 'weekly')),
  period_key   text NOT NULL,
  best_score   int  NOT NULL DEFAULT 0 CHECK (best_score BETWEEN 0 AND 100),
  best_grade   text NOT NULL DEFAULT 'D' CHECK (best_grade IN ('S', 'A', 'B', 'C', 'D')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, mode, period_key)
);

ALTER TABLE public.techhub_leaderboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "techhub_leaderboard_owner_read" ON public.techhub_leaderboard;
CREATE POLICY "techhub_leaderboard_owner_read"
  ON public.techhub_leaderboard
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_techhub_leaderboard_period
  ON public.techhub_leaderboard(mode, period_key, best_score DESC);
CREATE INDEX IF NOT EXISTS idx_techhub_leaderboard_user
  ON public.techhub_leaderboard(user_id);

-- ── 8) Hardening addendum (partials from the audit, all provably safe) ───────
-- Defense-in-depth column REVOKEs (078 trigger already guards these; the
-- REVOKE was the original migrations' declared intent).
-- POST-APPLY FINDING: these REVOKEs are NO-OPS in practice — `authenticated`
-- holds a TABLE-level UPDATE grant on profiles (needed for RLS self-updates),
-- and Postgres cannot subtract columns from a table-wide grant
-- (has_column_privilege stays TRUE). This is the same reason the ORIGINAL
-- migrations' REVOKEs never took, per the audit. The trigger guard
-- (guard_profiles_privileged_columns, 078/080/083) is the load-bearing
-- protection and covers every column below. True grant-level hardening would
-- mean revoking table UPDATE and granting an explicit column list — a
-- separate, riskier change; deliberately not done here.
REVOKE UPDATE (stripe_customer_id, stripe_subscription_id, subscription_tier,
  subscription_status, subscription_current_period_end, subscription_cancel_at,
  subscription_cycle) ON public.profiles FROM authenticated, anon;
REVOKE UPDATE (active_session) ON public.profiles FROM authenticated, anon;

-- 062's missing FORCE RLS (secret-column tables):
ALTER TABLE public.bluff_rounds  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sketch_rounds FORCE ROW LEVEL SECURITY;

-- Hot-path indexes (004 achievements, 019 notifications):
CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON public.achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, read) WHERE read = false;

-- 019's notifications RLS read/update-own policies (permissive; additive):
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- 008's bio length CHECK (app already clamps to 150; NOT VALID + VALIDATE so
-- a legacy long bio could never brick the apply):
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_bio_len;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_bio_len
  CHECK (bio IS NULL OR char_length(bio) <= 150) NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_bio_len;
