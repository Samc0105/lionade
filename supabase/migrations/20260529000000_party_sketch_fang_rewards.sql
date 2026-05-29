-- Migration 057: Lionade Party — Sketchy Subjects Fang reward faucet + Wordle reveal tracking.
--
-- Web-only. Adds a SMALL minted Fang participation faucet to Sketchy Subjects
-- (per correct guess, per newly-revealed correct-position letter, per drawing).
-- This is a faucet, NOT a wager — no Fangs are staked or transferred between
-- players, so there is no gambling surface. Numbers are tuned by data-economist
-- to stay below a single quiz session (see lib/party/sketch-economy.ts).
--
-- THE TWO TABLES:
--   1. sketch_fang_awards — append-only ledger of every Fang mint for a round.
--      UNIQUE(round_id, user_id, reason) makes each distinct award idempotent:
--      a guesser's "correct" mint, the drawer's "drawing" mint, etc., can each
--      be applied at most once even if the guess/complete endpoint is retried.
--      Per-letter awards use reason = 'letter:<position>' so each revealed
--      position is minted exactly once to whoever revealed it first.
--   2. sketch_revealed_positions — the authoritative "which letter positions are
--      already green" set for a round, written SERVER-SIDE only. The /guess
--      endpoint computes matched positions from (guess vs secret), and the FIRST
--      guesser to land a given position claims it (INSERT ... ON CONFLICT DO
--      NOTHING). The secret word never leaves the server: clients learn only the
--      set of matched positions (the green squares), never the underlying letters
--      for positions they haven't matched.
--
-- RLS: both tables follow the migration-055 hardening pattern — clients may read
-- only their OWN award rows; the room-wide reveal set is served exclusively
-- through the service-role /guess + /strokes routes (never a direct table read),
-- and all writes go through the service role.

-- ════════════════════════════════════════════════════════════════════════
-- sketch_fang_awards — per-round minted-Fang ledger (idempotent)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sketch_fang_awards (
  id          bigserial PRIMARY KEY,
  round_id    uuid NOT NULL REFERENCES sketch_rounds(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      text NOT NULL,            -- 'guess' | 'drawing' | 'letter:<pos>'
  fangs       int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_sketch_fang_awards_round
  ON sketch_fang_awards(round_id);
CREATE INDEX IF NOT EXISTS idx_sketch_fang_awards_user
  ON sketch_fang_awards(user_id, created_at DESC);

ALTER TABLE sketch_fang_awards ENABLE ROW LEVEL SECURITY;

-- A user reads only their OWN award rows (their Fang history). Cross-player
-- awards reach the client only via service-role API responses.
DROP POLICY IF EXISTS sketch_fang_awards_select_own ON sketch_fang_awards;
CREATE POLICY sketch_fang_awards_select_own ON sketch_fang_awards
  FOR SELECT USING (auth.uid() = user_id);

-- No client write policies: all writes go through the service role in /guess
-- and /complete. Belt-and-suspenders grant revoke alongside the row policy.
REVOKE INSERT, UPDATE, DELETE ON sketch_fang_awards FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- sketch_revealed_positions — server-authoritative "green squares" set
-- ════════════════════════════════════════════════════════════════════════
-- One row per (round, letter position) that has ever been matched by some
-- guesser. position is 0-indexed into the SECRET word. revealed_by records who
-- first claimed it (for the per-letter Fang). The letter character is stored so
-- the round route can render the progressive collaborative reveal WITHOUT the
-- client ever holding the unrevealed letters — only matched positions are sent.
CREATE TABLE IF NOT EXISTS sketch_revealed_positions (
  round_id     uuid NOT NULL REFERENCES sketch_rounds(id) ON DELETE CASCADE,
  position     int  NOT NULL,
  letter       text NOT NULL,           -- the matched character (already public via the guess)
  revealed_by  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  revealed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, position)
);

CREATE INDEX IF NOT EXISTS idx_sketch_revealed_positions_round
  ON sketch_revealed_positions(round_id);

ALTER TABLE sketch_revealed_positions ENABLE ROW LEVEL SECURITY;

-- The revealed-position set is room-wide PROGRESS, not a secret (a position is
-- in here only because some guesser already typed that exact letter in that
-- exact spot). Even so, it reaches clients through the service-role round
-- routes; we keep direct client reads off to avoid a guesser pre-fetching the
-- whole set out of band. (The set never contains UNmatched positions, so even a
-- direct read could not leak the rest of the word.)
DROP POLICY IF EXISTS sketch_revealed_positions_select ON sketch_revealed_positions;
CREATE POLICY sketch_revealed_positions_select ON sketch_revealed_positions
  FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON sketch_revealed_positions FROM anon, authenticated;
