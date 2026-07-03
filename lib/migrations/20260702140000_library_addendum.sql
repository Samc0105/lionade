-- 20260702140000_library_addendum.sql
-- ============================================================
-- HELD: apply manually (Sam) via the Supabase SQL editor. UNAPPLIED.
-- MUST be applied AFTER 20260702130000_study_sets.sql — everything below
-- references study_sets, which that migration creates (it also already
-- defines the library columns is_public / published_at / clone_count /
-- cloned_from, so this addendum only adds what the Library routes need on
-- top: two indexes + the reports table).
--
-- FAIL-SOFT CONTRACT (until applied):
--   - Browse/publish/clone/tip run off 20260702130000 alone; ONLY the
--     report route needs this file. POST /api/library/[id]/report returns
--     503 { unavailable: true } with honest copy while library_reports is
--     missing (lib/library/schema-guard.ts catches 42P01/42703), and the
--     publish route's >= 3-open-reports republish guard safely reads a
--     missing table as zero reports.
--   - Without idx_study_sets_one_clone_per_source the clone route's
--     one-clone-per-user check still holds on the request path; only the
--     double-tap RACE loses its DB backstop. Apply promptly.
--
-- RELATED HELD MIGRATION: tips also need coin_transactions types
-- set_tip_sent / set_tip_received from 20260702090000_web_features_ledger_types.sql.
-- Until THAT one is applied, the tip route refunds the spend on the 23514
-- ledger reject and returns tipsPending: true (net zero Fang movement).
--
-- Safe to re-run: IF NOT EXISTS throughout.

-- ── 1) Library indexes on study_sets ─────────────────────────────────────────

-- One clone per user per source set — race-safe backing for the route check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_study_sets_one_clone_per_source
  ON study_sets (user_id, cloned_from)
  WHERE cloned_from IS NOT NULL;

-- Browse hot path: public sets ordered by clone_count DESC, published_at DESC
-- (20260702130000's idx_study_sets_public_published only covers published_at).
CREATE INDEX IF NOT EXISTS idx_study_sets_library_browse
  ON study_sets (clone_count DESC, published_at DESC)
  WHERE is_public;

-- ── 2) library_reports — minimal community-safety queue ─────────────────────

CREATE TABLE IF NOT EXISTS library_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  reporter UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 280),
  -- 'dismissed' = admin judged the report unfounded; 'upheld' = admin agreed
  -- (the set is force-unpublished and blocked from republishing). 'resolved'
  -- is a reserved neutral terminal state.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed', 'upheld')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One OPEN report per user per set (re-reporting after resolution is allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_reports_open_unique
  ON library_reports (set_id, reporter)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_library_reports_set_status
  ON library_reports (set_id, status);

ALTER TABLE library_reports ENABLE ROW LEVEL SECURITY;

-- Service-role only ON PURPOSE (no policies): reports are written by the API
-- route and read by the admin queue. A user JWT can neither browse other
-- users' reports nor fabricate report volume to force auto-unpublish.

COMMENT ON TABLE library_reports IS
  'Community reports against public study sets. >= 3 unique open reporters auto-unpublishes the set (service-role check on insert). Service-role reads/writes only.';
