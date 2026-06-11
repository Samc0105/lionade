-- 060_settings_overhaul.sql
-- 2026-06-11 - Settings overhaul: data foundation
--
-- Backend foundation for the 6-section settings UI. Additive + idempotent.
-- NOT YET APPLIED - Sam runs this manually.
--
-- What this migration does:
--   1. profiles.deactivated_at    timestamptz null  - soft-deactivate (reactivatable)
--   2. profiles.pending_deletion_at timestamptz null - scheduled hard-delete window
--   3. Widen the profile_visibility CHECK to add 'friends' (public/friends/private).
--      The column itself already exists (migration 20260605142539). We drop the
--      auto-named inline CHECK and re-add it with the wider allow-set. Default
--      stays 'public'. The partial index on 'public' is unaffected.
--   4. New table user_login_events - append-only login audit (for the Security
--      section "recent sign-ins" list). RLS owner-only SELECT + FORCE; inserts
--      go through the service role (supabaseAdmin), which bypasses RLS.
--
-- Enforcement note: search/leaderboard treat 'friends' as NON-public (excluded
-- from public surfaces), same as 'private'. That logic lives in the API/db layer
-- (app/api/social/search + lib/db.ts ladders) - no DB-side change needed for it.

BEGIN;

-- ── 1 + 2. Account-lifecycle timestamps on profiles ──────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_deletion_at timestamptz;

COMMENT ON COLUMN public.profiles.deactivated_at IS
  'Settings overhaul (2026-06-11): non-null = account self-deactivated (hidden, reactivatable). Distinct from pending_deletion_at.';
COMMENT ON COLUMN public.profiles.pending_deletion_at IS
  'Settings overhaul (2026-06-11): non-null = hard deletion scheduled for this timestamp. A cron/admin job performs the actual purge.';

-- ── 3. Widen profile_visibility CHECK to add ''friends'' ─────────
-- The inline CHECK from migration 20260605142539 (ADD COLUMN ... CHECK (...))
-- is auto-named profiles_profile_visibility_check by Postgres. Drop-then-add
-- so this is safe to re-run.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_profile_visibility_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_profile_visibility_check
    CHECK (profile_visibility IN ('public', 'friends', 'private'));

COMMENT ON COLUMN public.profiles.profile_visibility IS
  'Settings overhaul (2026-06-11): ''public'' = discoverable in search + leaderboard (default). ''friends'' = visible to accepted friends only (excluded from public search/leaderboard, same as private). ''private'' = excluded everywhere. Notification + show-on-leaderboard sub-flags live in profiles.preferences JSONB.';

-- ── 4. user_login_events - append-only login audit ──────────────
CREATE TABLE IF NOT EXISTS public.user_login_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Recent-sign-ins lookup: newest-first per user.
CREATE INDEX IF NOT EXISTS idx_user_login_events_user_created
  ON public.user_login_events (user_id, created_at DESC);

ALTER TABLE public.user_login_events ENABLE ROW LEVEL SECURITY;
-- FORCE so even the table owner role is subject to RLS - only the service
-- role (which bypasses RLS) writes, and the owner-only SELECT policy is the
-- ONLY client-reachable path.
ALTER TABLE public.user_login_events FORCE ROW LEVEL SECURITY;

-- Idempotent policy creation (drop-if-exists for safe re-runs).
DROP POLICY IF EXISTS user_login_events_select_own ON public.user_login_events;

-- Owners read their own login events (Security section "recent sign-ins").
CREATE POLICY user_login_events_select_own ON public.user_login_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE: no client policies. Writes happen via supabaseAdmin
-- (service role) at the sign-in path. Account-deletion cleanup via ON DELETE CASCADE.

COMMENT ON TABLE public.user_login_events IS
  'Settings overhaul (2026-06-11): append-only login audit for the Security section recent-sign-ins list. Service-role insert only; RLS owner-only SELECT + FORCE.';

COMMIT;
