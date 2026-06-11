-- Migration 058: Competitive match VOID + FORFEIT terminal states.
--
-- Web-only. Implements the "ELO only moves when BOTH players actually played"
-- principle for the competitive 4-mode arena.
--
-- THE RULE (enforced in app/api/competitive/match/[id]/complete + /forfeit + the
-- /api/cron/reap-stale-competitive reaper):
--   ELO + Fangs settle ONLY when BOTH teams recorded at least one
--   competitive_response (a real contest happened). If one side has ZERO
--   responses (no-show / instant disconnect / never engaged), the match is
--   VOIDED: status 'voided', NO ELO change, NO Fang transfer, no penalty to the
--   player who did show. A mid-match quit where both sides have >=1 response IS a
--   real contest and settles normally (the quitter's unanswered rounds score 0,
--   so they likely lose, so ELO moves).
--
-- This migration only widens the set of TERMINAL statuses the settle paths may
-- write and adds a `forfeited_by` column to record who conceded. The 054 table
-- declared `status text NOT NULL DEFAULT 'queued'` with a comment but NO explicit
-- CHECK constraint, so this migration is written idempotently to work whether or
-- not a status CHECK already exists on the live table:
--   - Drop any existing status CHECK by its known name (no-op if absent).
--   - Add a single named CHECK allowing every valid status, including the two
--     new terminal states 'voided' and 'forfeited'.
--   - Add the nullable `forfeited_by` column IF NOT EXISTS.
--
-- DO NOT APPLY blindly: this is shipped as a file for dev-database to review and
-- run via the normal migration path.

-- ── competitive_matches.forfeited_by — who conceded (NULL unless forfeited) ──
ALTER TABLE competitive_matches
  ADD COLUMN IF NOT EXISTS forfeited_by uuid REFERENCES profiles(id);

-- ── Widen the status CHECK to include the two new terminal states ──
-- Idempotent: drop-then-add so re-running the migration converges. We name the
-- constraint explicitly so future migrations can find it. Any older anonymous or
-- differently-named status check is also dropped below if present.
DO $$
DECLARE
  c record;
BEGIN
  -- Drop ALL existing CHECK constraints on competitive_matches whose definition
  -- references the status column, so we can replace them with the canonical one.
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'competitive_matches'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE competitive_matches DROP CONSTRAINT %I', c.conname);
  END LOOP;
END$$;

ALTER TABLE competitive_matches
  ADD CONSTRAINT competitive_matches_status_check
  CHECK (status IN (
    'queued',
    'active',
    'completing',   -- transient atomic-claim state used by /complete + /forfeit
    'completed',
    'voided',       -- one side never engaged: no ELO, no Fangs, no penalty
    'forfeited'     -- a participant conceded a REAL contest (both sides engaged)
  ));
