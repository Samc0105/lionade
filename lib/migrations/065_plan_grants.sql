-- ============================================================
-- Migration 065: plan_grants — admin/manual entitlement grants
-- To be APPLIED to production via Supabase MCP after review.
-- Kept in the repo as the canonical record. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY:
-- Until now the only paths to a paid tier were (a) a live Stripe subscription
-- writing profiles.subscription_tier/subscription_status (migration 060301), or
-- (b) Sam manually bumping profiles.plan by hand. (b) is lossy: there is no
-- record of WHO granted it, WHY, whether it should expire, or how to revoke it
-- without clobbering a real Stripe tier. This table makes manual / comped /
-- support / promo entitlements first-class and auditable WITHOUT touching the
-- effective-plan readers.
--
-- ENTITLEMENT MODEL (unchanged readers):
--   profiles.plan stays the single EFFECTIVE plan every reader already trusts
--   (lib/use-plan.ts isPaid, lib/mastery-plan.ts effectiveTier, save-quiz-results,
--   missions, competitive). This migration does NOT change those readers and does
--   NOT change how profiles.plan is read. It adds a NEW source of truth that the
--   server resolver folds INTO profiles.plan.
--
--   plan_grants holds explicit grants (tier + optional expiry). The backend
--   resolver recomputeEffectivePlan(userId) computes:
--       effective = highest of [
--         stripe_baseline,                         -- see below
--         highest ACTIVE grant tier                -- this table
--       ]
--   with tier order platinum > pro > free, then UPDATEs profiles.plan = effective.
--   It is the single point that reconciles Stripe + grants and must be called
--   after every grant create / revoke / expiry sweep AND from the Stripe webhook.
--
--   STRIPE BASELINE columns the resolver reads (confirmed present on profiles via
--   migration 20260603010601_stripe_subscriptions.sql):
--       subscription_status   text  CHECK (trialing|active|past_due|canceled|incomplete)
--       subscription_tier     text  NOT NULL DEFAULT 'free' CHECK (free|pro|platinum)
--   stripe_baseline = (subscription_status = 'active') ? subscription_tier : 'free'
--
-- SECURITY MODEL:
--   A grant is a privileged object — owning a paid tier has real economic value
--   (multipliers, cash-out caps, mastery access). Users may READ their own grants
--   (so the client can show "comped until <date>") but there is NO user-side
--   write path. All INSERT/UPDATE/DELETE happens via service_role in /api/admin/*
--   routes, which bypass RLS. We therefore enable RLS, add a SELECT-own policy,
--   and deliberately add NO write policy (mirrors admin_audit_log / 057 and
--   stripe_webhook_events / 060301: RLS-on + no write policy = service-role-only
--   writes). Defense-in-depth column/table grants are revoked from anon below.

-- ── 1. table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tier        text NOT NULL CHECK (tier IN ('pro', 'platinum')),
  -- NULL expires_at == lifetime grant. Non-null == expires at that instant;
  -- the resolver treats expires_at <= now() as inactive.
  expires_at  timestamptz,
  -- where the grant came from: 'admin' (manual console), 'promo', 'support',
  -- 'comp', etc. Free-form on purpose; the admin route decides the vocabulary.
  source      text NOT NULL DEFAULT 'admin',
  -- staff profile that issued the grant. Nullable + SET NULL so deleting a
  -- staff account never blocks/cascades the grant rows it issued.
  granted_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason      text,
  -- soft revoke: set instead of DELETE so revocations stay auditable. The
  -- resolver treats revoked_at IS NOT NULL as inactive.
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. indexes ────────────────────────────────────────────────────────
-- Per-user lookup: the resolver and the client "my grants" read both filter
-- by user_id.
CREATE INDEX IF NOT EXISTS idx_plan_grants_user_id
  ON plan_grants (user_id);

-- Active-grants partial index: the resolver only ever cares about grants that
-- are not revoked and not yet expired. Keeping the predicate partial keeps the
-- index tiny (revoked/expired rows fall out) and makes "highest active grant
-- for this user" an index-only-ish scan.
-- NOTE: now() is not IMMUTABLE so it cannot live in the partial predicate; we
-- index the not-revoked set and let the resolver's WHERE filter expiry. This
-- still excludes every revoked row, which is the bulk of dead grants over time.
CREATE INDEX IF NOT EXISTS idx_plan_grants_active
  ON plan_grants (user_id, tier, expires_at)
  WHERE revoked_at IS NULL;

-- ── 3. RLS ────────────────────────────────────────────────────────────
ALTER TABLE plan_grants ENABLE ROW LEVEL SECURITY;

-- Users may READ their own grants (read-only). No write policies exist, so
-- with RLS enabled the authenticated/anon roles cannot INSERT/UPDATE/DELETE.
-- service_role (supabaseAdmin in /api/admin/* grant + revoke routes) bypasses
-- RLS entirely and remains the only write path.
DROP POLICY IF EXISTS "plan_grants_select_own" ON plan_grants;
CREATE POLICY "plan_grants_select_own" ON plan_grants
  FOR SELECT USING (auth.uid() = user_id);

-- Deliberately NO INSERT / UPDATE / DELETE policy: writes are service-role only.

-- ── 4. defense-in-depth grants ────────────────────────────────────────
-- anon should never touch this table (RLS already blocks it, but make the
-- privilege model self-documenting). authenticated keeps table SELECT so the
-- RLS SELECT-own policy can apply; it gets no write privilege so even a future
-- accidental write policy can't be exploited without an explicit grant.
REVOKE ALL ON plan_grants FROM anon;
REVOKE INSERT, UPDATE, DELETE ON plan_grants FROM authenticated;
GRANT SELECT ON plan_grants TO authenticated;
GRANT ALL ON plan_grants TO service_role;
