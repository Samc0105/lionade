-- 2026-06-05 — P0 trust-gap fix
--
-- Adds the server-enforceable profile_visibility column so the Privacy
-- section in /profile and /settings stops being a localStorage-only
-- placebo. Before this migration, "set my profile to private" only wrote
-- to the browser's localStorage and /api/social/search returned the user
-- anyway — a TRUST gap, not a UX one.
--
-- Notification + privacy toggle persistence (Daily Reminder, Show on
-- Leaderboard, etc.) reuses the existing profiles.preferences JSONB
-- column — no new columns needed; the lib/db.ts UserPreferences type
-- gets two new substructures (notifications + privacy) that merge into
-- the same JSONB blob.
--
-- profile_visibility is a TOP-LEVEL column (not JSONB) so the server
-- can:
--   1. Cheaply filter it in /api/social/search (.eq("profile_visibility",
--      "public"))
--   2. Cheaply filter the leaderboard ladders (.neq("profile_visibility",
--      "private")) via lib/db.ts:getLadderLeaderboard +
--      getLeaderboard + getEloLeaderboard.
--
-- Two visibility values are supported now:
--   'public'   → discoverable in search + leaderboard (default)
--   'private'  → excluded from search + leaderboard
-- The original profile audit (P0 #3) mentioned a third value 'friends'
-- but enforcing "only my friends see me" requires a join against the
-- friendships table on every list query — deferred to follow-up. The UI
-- still presents the public/private split for now (friends UI removed
-- in the frontend changes).
--
-- Additive + nullable + defaulted — safe to apply on a live table.

BEGIN;

-- Add the visibility column. CHECK constraint pins the allowed values so
-- the server can never store an arbitrary string here.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public', 'private'));

-- Backfill is unnecessary because the DEFAULT 'public' applies to every
-- existing row immediately. Comment is for posterity:
-- UPDATE public.profiles SET profile_visibility = 'public' WHERE profile_visibility IS NULL;

-- Index on the visibility column so leaderboard + search filters don't
-- table-scan as the user base grows. Partial index on 'public' since
-- that's what every listing query will filter to.
CREATE INDEX IF NOT EXISTS idx_profiles_visibility_public
  ON public.profiles (profile_visibility)
  WHERE profile_visibility = 'public';

COMMENT ON COLUMN public.profiles.profile_visibility IS
  'P0 trust-gap fix (2026-06-05): server-enforceable visibility. ''public'' = discoverable in search + leaderboard. ''private'' = excluded. Notification + show-on-leaderboard sub-flags live in profiles.preferences JSONB.';

COMMIT;
