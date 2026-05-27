-- Migration 049: Arena V2 — async ghost duels foundation.
--
-- Phase 1 backend foundation for the Arena 1v1 V2 redesign (web-only scope
-- per CEO 2026-05-26). All code paths that read these tables/columns are
-- gated behind `process.env.NEXT_PUBLIC_ARENA_V2_ENABLED === "true"`; V1
-- Arena keeps running unchanged for live users.
--
-- What this migration adds:
--   1. `duel_ghosts` — recorded duel runs (10 questions + per-question
--      answers + timing) that future challengers replay against. Created
--      lazily after a V2 match completes, but ONLY for users who have
--      consented (profiles.ghost_consent_at IS NOT NULL).
--   2. `profiles.ghost_consent_at` — opt-in timestamp from the first-duel
--      consent modal. NULL = not consented yet, no ghost rows are created.
--   3. `profiles.ghost_show_username` — adult opt-in to reveal real
--      username on ghost cards. Defaults FALSE (anonymized handle).
--      Under-18 force-anonymized is enforced at API layer, not here.
--   4. `profiles.ghost_anon_handle` — generated handle ("Shadow Wolf 4729")
--      assigned at first consent. Stable across the user's ghost rows.
--   5. arena_matches columns: `is_async`, `ghost_id`, `is_trainer_match`,
--      `subject` — let a V2 match record reference the ghost it replayed
--      against and the subject lock.
--   6. Trainer Ninny system user (deterministic UUID) — owner_user_id for
--      the 30 pre-seeded ghosts so the FK to profiles holds.
--   7. Index on (subject, elo_at_recording, recorded_at) for the matcher's
--      range query in lib/arena-v2/ghost-matcher.ts.
--
-- RLS:
--   - duel_ghosts: enable RLS.
--     - SELECT own: `auth.uid() = owner_user_id` — owner can read their own
--       runs (vanity stats "your ghost was challenged 47 times").
--     - SELECT non-owned for matchmaking: `auth.uid() <> owner_user_id` —
--       all authenticated users can read other people's ghosts (questions,
--       answers, timing) so the client-side replay engine can drive
--       playback. No PII in the row (the owner's display identity is
--       resolved server-side via the anonymization rules).
--     - INSERT/UPDATE/DELETE: NO client policies — only the service-role
--       writer at app/api/arena/v2/complete/route.ts may write, and the
--       hard-delete-on-account-deletion is handled by ON DELETE CASCADE.
--
-- Cascade: `owner_user_id REFERENCES profiles(id) ON DELETE CASCADE` is the
-- "hard-delete on account deletion" requirement from the locked spec.
-- A future "Delete my ghost history" button (Phase 2) will issue a scoped
-- DELETE WHERE owner_user_id = me without touching the profile.

-- ── profiles columns ─────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ghost_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS ghost_show_username boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ghost_anon_handle text,
  ADD COLUMN IF NOT EXISTS last_shake_it_off_at timestamptz;

COMMENT ON COLUMN profiles.last_shake_it_off_at IS
  'Arena V2: last time the 3-loss-streak +25F gift was dispensed; throttled to one per 24h.';

COMMENT ON COLUMN profiles.ghost_consent_at IS
  'Arena V2: timestamp of opt-in to duel-ghost recording. NULL = no ghost rows created.';
COMMENT ON COLUMN profiles.ghost_show_username IS
  'Arena V2: adult opt-in to reveal real username on ghost cards. Always false for under-18 at API layer.';
COMMENT ON COLUMN profiles.ghost_anon_handle IS
  'Arena V2: stable anonymized handle ("Shadow Wolf 4729"), generated at first consent.';

-- ── arena_matches columns ───────────────────────────────────────
ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS is_async boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ghost_id uuid,
  ADD COLUMN IF NOT EXISTS is_trainer_match boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subject text;

COMMENT ON COLUMN arena_matches.is_async IS
  'Arena V2: true when the opponent was a recorded ghost (not a live sync queue match).';
COMMENT ON COLUMN arena_matches.ghost_id IS
  'Arena V2: ghost the live player replayed against (FK added after duel_ghosts is created).';
COMMENT ON COLUMN arena_matches.is_trainer_match IS
  'Arena V2: true when the opponent ghost was a labeled Trainer Ninny seed.';
COMMENT ON COLUMN arena_matches.subject IS
  'Arena V2: subject lock for matchmaking (legacy V1 rows leave this NULL).';

-- ── Trainer Ninny system user (deterministic UUID) ──────────────
-- Seeded so seed-trainer-ninny-ghosts.ts can FK to it.
-- Username is reserved + flagged via is_trainer_ninny so the rest of the
-- app can ignore it from leaderboards/social/etc.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_trainer_ninny boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.is_trainer_ninny IS
  'Arena V2: marks the system user that owns pre-seeded Trainer Ninny ghosts. Excluded from leaderboards/social.';

-- profiles.id references auth.users(id), so the auth user must exist first.
-- This is a system identity (no real password, internal email).
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES (
  '00000000-0000-0000-0000-00000000a155'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'trainer-ninny@lionade.internal',
  now(), now(), now(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"name":"Trainer Ninny"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, username, is_trainer_ninny, ghost_consent_at, ghost_anon_handle)
VALUES (
  '00000000-0000-0000-0000-00000000a155'::uuid,
  'trainer_ninny',
  true,
  now(),
  'Trainer Ninny'
)
ON CONFLICT (id) DO UPDATE SET is_trainer_ninny = EXCLUDED.is_trainer_ninny;

-- ── duel_ghosts table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duel_ghosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject text NOT NULL,
  elo_at_recording integer NOT NULL,
  question_ids uuid[] NOT NULL DEFAULT '{}',
  -- answers shape: [{ question_id: uuid, selected_index: int, time_ms: int, correct: bool }, ...]
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_score integer NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  is_trainer boolean NOT NULL DEFAULT false
);

ALTER TABLE duel_ghosts ENABLE ROW LEVEL SECURITY;

-- Idempotent policy creation (drop-if-exists for safe re-runs after
-- partial-apply failures).
DROP POLICY IF EXISTS duel_ghosts_select_own ON duel_ghosts;
DROP POLICY IF EXISTS duel_ghosts_select_others ON duel_ghosts;

-- Owners read their own ghosts (vanity stats).
CREATE POLICY duel_ghosts_select_own ON duel_ghosts
  FOR SELECT
  USING (auth.uid() = owner_user_id);

-- Authenticated users read non-owned ghosts for matchmaking + replay.
-- No PII columns here — owner identity is resolved server-side per
-- consent + ghost_show_username + under-18 rules.
CREATE POLICY duel_ghosts_select_others ON duel_ghosts
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth.uid() <> owner_user_id);

-- INSERT / UPDATE / DELETE: no client policies. Writes happen via
-- supabaseAdmin (service role) at app/api/arena/v2/complete/route.ts,
-- which bypasses RLS. Account-deletion cleanup is via ON DELETE CASCADE.

-- Matchmaking range index — used by the ghost-matcher cascade
-- (subject-strict, ELO ±300, recorded_at within 24h → 7d).
CREATE INDEX IF NOT EXISTS idx_duel_ghosts_match
  ON duel_ghosts (subject, elo_at_recording, recorded_at DESC);

-- Trainer Ninny lookup index (separate from real-user matches).
CREATE INDEX IF NOT EXISTS idx_duel_ghosts_trainer
  ON duel_ghosts (subject, elo_at_recording)
  WHERE is_trainer = true;

-- Owner-side index for vanity stats query.
CREATE INDEX IF NOT EXISTS idx_duel_ghosts_owner
  ON duel_ghosts (owner_user_id, recorded_at DESC);

-- Back-fill the arena_matches.ghost_id FK now that duel_ghosts exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'arena_matches_ghost_id_fkey'
  ) THEN
    ALTER TABLE arena_matches
      ADD CONSTRAINT arena_matches_ghost_id_fkey
      FOREIGN KEY (ghost_id) REFERENCES duel_ghosts(id) ON DELETE SET NULL;
  END IF;
END$$;
