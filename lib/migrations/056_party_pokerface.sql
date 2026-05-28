-- Migration 056: Poker Face — moved into Lionade Party as the 3rd party game.
--
-- Web-only per CEO scope override 2026-05-28 (iOS port paused; IOS_PARITY row
-- flipped to "moved to Party"). Spec locked at
--   ~/.claude/projects/-Users-samc-Desktop-lionade/memory/project_lionade_party.md
--   ~/.claude/projects/-Users-samc-Desktop-lionade/memory/project_competitive_modes.md
--
-- WHAT CHANGED (vs the killed competitive Poker Face):
--   Poker Face is now an N-player (3-8) party game alongside Sketchy Subjects +
--   Bluff Trivia. One presenter per round holds a secret fact card, presents it
--   truthfully or as a lie, and everyone else calls BELIEVE or DOUBT. The
--   presenter rotates each round. NO ELO, NO Fang wager, NO currency at all —
--   pure points / bragging rights (same as the other two party games). This kills
--   the gambling/legal concern entirely: there is no `pokerface-wager` here.
--
-- WHAT THIS MIGRATION ADDS:
--   1. `party_pokerface_rounds` — per-round presenter/card/claim/phase state. The
--      SECRET columns (card_fact, is_lie, claim_text) must never reach a caller
--      before reveal, so we apply the SAME RLS HARDENING PATTERN as migration 055.
--   2. `party_pokerface_votes` — each non-presenter's believe/doubt call. A voter
--      may read only their OWN vote directly (everyone else's calls reach the room
--      through the service-role round route).
--   3. Realtime publication entries (low-frequency phase/round-advance nudges).
--
-- RLS (carries the migration-055 lessons exactly):
--   The Supabase ANON KEY ships in the browser bundle, so any authenticated user
--   could point the JS client at these tables and read secret columns directly,
--   bypassing the sanitizing API routes. Postgres RLS is row-level (not
--   column-level), so we cannot "hide a column" with a policy. The robust pattern
--   (verified: no client component queries these tables directly — the party
--   pokerface UI fetches all in-flight state through service-role /api/party/*
--   routes):
--     1. REVOKE direct client (anon + authenticated) SELECT on the rounds table
--        that carries the secret. The service-role client used by /api/* routes
--        BYPASSES RLS + table grants, so the legit fetch path is untouched.
--     2. Replace the permissive SELECT policy with a PRESENTER-OR-REVEALED policy:
--        a round is directly readable by the client only when it is at the reveal
--        phase / has ended, OR the requester is the presenter (who legitimately
--        knows their own card + claim). In-flight secrets stay hidden to callers.
--     3. Votes: a voter reads only their own row; cross-player calls reach the
--        client exclusively through the service-role complete/round endpoints.
--
-- Server-authoritative scoring: the /complete-round endpoint computes every
-- score server-side (presenter fooled-caller points + caller correct-call points)
-- from the persisted is_lie + votes; the client NEVER submits scores. This mirrors
-- the Bluff scoring path and the migration-055 server-authoritative invariant.
--
-- The legacy `pokerface_hands` table (competitive, migration 054) is now UNUSED.
-- It is left in place (harmless) and intentionally NOT dropped in this migration;
-- documented in CHANGELOG / FEATURES / IOS_PARITY.

-- ── party_pokerface_rounds ────────────────────────────────────────────
-- phase lifecycle: 'present' (presenter is choosing truth/lie + writing claim)
--   -> 'vote' (callers submit believe/doubt) -> 'reveal' (truth shown + scored).
-- SECRET columns: card_fact (the true fact), is_lie (whether the presenter lied),
-- claim_text (what the presenter chose to show — may be the truth or an invented
-- lie). These must not reach a caller before phase='reveal'.
CREATE TABLE IF NOT EXISTS party_pokerface_rounds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id            uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  round_num          int NOT NULL,
  presenter_user_id  uuid NOT NULL REFERENCES profiles(id),
  card_word          text NOT NULL,           -- shown to the room (not secret)
  card_fact          text NOT NULL,           -- SECRET: the verifiably true fact
  claim_text         text,                    -- SECRET: what the presenter shows (truth or lie); null until presented
  is_lie             boolean,                 -- SECRET: true if the presenter bluffed; null until presented
  phase              text NOT NULL DEFAULT 'present',  -- present | vote | reveal
  started_at         timestamptz NOT NULL DEFAULT now(),
  presented_at       timestamptz,             -- set when the presenter submits truth/lie + claim
  ended_at           timestamptz,
  UNIQUE (room_id, round_num)
);

CREATE INDEX IF NOT EXISTS idx_party_pokerface_rounds_room
  ON party_pokerface_rounds(room_id, round_num);

ALTER TABLE party_pokerface_rounds ENABLE ROW LEVEL SECURITY;

-- Presenter-or-revealed SELECT (the migration-055 owner-or-ended pattern). A
-- caller can read the row directly only once it has reached reveal/ended; the
-- presenter may always read their own round (they wrote the claim + know the
-- card). Even if a future client reads directly, in-flight secrets stay hidden.
DROP POLICY IF EXISTS party_pokerface_rounds_select ON party_pokerface_rounds;
CREATE POLICY party_pokerface_rounds_select ON party_pokerface_rounds
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (phase = 'reveal' OR ended_at IS NOT NULL OR presenter_user_id = auth.uid())
  );
-- Belt-and-suspenders: revoke the public-key client's table grant entirely. The
-- service role used by /api/party/pokerface/* bypasses this; legit reads are
-- unaffected. No client write policies — every write goes through the service role.
REVOKE SELECT ON party_pokerface_rounds FROM anon, authenticated;

-- ── party_pokerface_votes ─────────────────────────────────────────────
-- One row per non-presenter per round. call = 'believe' | 'doubt'. UNIQUE on
-- (round_id, voter_user_id) makes a re-call idempotent (upsert replaces).
CREATE TABLE IF NOT EXISTS party_pokerface_votes (
  round_id       uuid NOT NULL REFERENCES party_pokerface_rounds(id) ON DELETE CASCADE,
  voter_user_id  uuid NOT NULL REFERENCES profiles(id),
  call           text NOT NULL,               -- believe | doubt
  voted_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_party_pokerface_votes_round
  ON party_pokerface_votes(round_id);

ALTER TABLE party_pokerface_votes ENABLE ROW LEVEL SECURITY;

-- A voter reads only their OWN call directly (so a caller can't peek at how the
-- room is leaning, which would leak the bluff). The room-wide tally reaches the
-- client only through the service-role round/complete route at reveal.
DROP POLICY IF EXISTS party_pokerface_votes_select ON party_pokerface_votes;
CREATE POLICY party_pokerface_votes_select ON party_pokerface_votes
  FOR SELECT USING (auth.uid() = voter_user_id);
REVOKE SELECT ON party_pokerface_votes FROM anon, authenticated;

-- ── Realtime publication ──────────────────────────────────────────────
-- Add the two tables so clients receive low-frequency phase/round-advance ticks.
-- Realtime postgres_changes are ALSO filtered by RLS, so with the policies above
-- a non-presenter subscribed to party_pokerface_rounds receives the row only once
-- it reaches reveal/ended. The sanitized API route remains the source of truth
-- for in-flight content; realtime is purely an "advance happened" nudge.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'party_pokerface_rounds',
    'party_pokerface_votes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END$$;
