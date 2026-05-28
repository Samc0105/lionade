-- Migration 055: Competitive + Party RLS hardening + server-authoritative scoring.
--
-- Web-only. Closes the security review's 4 CRITICAL game-state leaks (051 + 054)
-- and the 1 HIGH client-trusted scoring finding. Push-gate for both features.
--
-- THE PROBLEM (migrations 051 + 054):
--   Every per-round / per-answer / per-hand table shipped with a permissive
--   `auth.uid() IS NOT NULL` SELECT policy. The Supabase ANON KEY is public (it
--   ships in the browser bundle), so ANY authenticated user could open devtools,
--   point the JS client at these tables, and read SECRET columns directly,
--   bypassing every sanitizing API route:
--     - sabotage_rounds.correct_index   (read the right answer mid-match)
--     - zoom_rounds.answer / .aliases   (read the image label before guessing)
--     - spectrum_rounds.true_value      (read the exact target)
--     - pin_rounds.true_lat / true_lng  (read the exact coordinates)
--     - pokerface_hands.is_truth / card_fact / claim_text (know if opponent lies)
--     - bluff_rounds.correct_answer + bluff_answers.is_truth/user_id (pre-reveal)
--     - sketch_rounds.word / .factoid   (a guesser reads the word to draw)
--
-- THE FIX (architecture, not a patch):
--   Postgres RLS is row-level, not column-level, so we cannot "hide a column"
--   with a policy. The robust pattern, given that the legitimate clients ALREADY
--   fetch all in-flight round data through service-role API routes (verified:
--   no client component queries these tables directly):
--
--     1. REVOKE direct client (anon + authenticated) SELECT on every table that
--        carries a secret column. The service-role client used by /api/* routes
--        BYPASSES RLS and table grants, so the legit fetch path is untouched.
--        This is belt-and-suspenders alongside the row policy below.
--     2. Replace each permissive SELECT policy with an OWNER-OR-ENDED policy:
--        a row is directly readable by the client only when the round/hand is
--        over (ended_at IS NOT NULL, or pokerface phase IN ('reveal','done')) OR
--        the requester legitimately owns the secret (drawer / presenter / author).
--        Even if a future client reads directly, in-flight secrets stay hidden.
--     3. Add `competitive_responses` for SERVER-AUTHORITATIVE per-player scoring.
--        The /answer endpoint scores each raw answer against the round secret
--        server-side and persists points here; /complete sums these (never the
--        client-submitted scores). Users may read ONLY their own responses.
--
-- Net effect: secrets are unreadable by the client until the round legitimately
-- ends, and match outcomes are computed only from server-scored responses.

-- ════════════════════════════════════════════════════════════════════════
-- PART A — competitive_responses: server-authoritative per-player scoring
-- ════════════════════════════════════════════════════════════════════════
-- One row per player per round. raw_answer holds the submitted guess (idx /
-- text / number / {lat,lng}) for audit; points is the SERVER-computed score the
-- /complete endpoint trusts. UNIQUE(match_id, round_num, user_id) makes submit
-- idempotent (first scored answer wins; later resubmits are rejected upstream).
CREATE TABLE IF NOT EXISTS competitive_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES competitive_matches(id) ON DELETE CASCADE,
  round_num     int NOT NULL,
  mode          text NOT NULL,                 -- sabotage | zoom | spectrum | pin
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  raw_answer    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_correct    boolean NOT NULL DEFAULT false,
  points        int NOT NULL DEFAULT 0,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, round_num, user_id)
);

CREATE INDEX IF NOT EXISTS idx_competitive_responses_match
  ON competitive_responses(match_id, user_id);

ALTER TABLE competitive_responses ENABLE ROW LEVEL SECURITY;

-- A user may read ONLY their own responses (history / "your card"). Cross-player
-- responses (the opponent's points) reach the client exclusively through the
-- service-role /complete + /match endpoints, never via a direct table read.
DROP POLICY IF EXISTS competitive_responses_select_own ON competitive_responses;
CREATE POLICY competitive_responses_select_own ON competitive_responses
  FOR SELECT USING (auth.uid() = user_id);

-- No client write policies: all writes go through the service role in /answer.
REVOKE INSERT, UPDATE, DELETE ON competitive_responses FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- PART B — Competitive round/hand tables: owner-or-ended SELECT + REVOKE
-- ════════════════════════════════════════════════════════════════════════

-- ── sabotage_rounds: correct_index is the secret ──
-- Readable directly only once the round has ended. In-flight content (question,
-- options) reaches both players via the sanitized /api/competitive/match route.
DROP POLICY IF EXISTS sabotage_rounds_select ON sabotage_rounds;
CREATE POLICY sabotage_rounds_select ON sabotage_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL AND ended_at IS NOT NULL);
REVOKE SELECT ON sabotage_rounds FROM anon, authenticated;

-- ── zoom_rounds: answer + aliases are the secret ──
DROP POLICY IF EXISTS zoom_rounds_select ON zoom_rounds;
CREATE POLICY zoom_rounds_select ON zoom_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL AND ended_at IS NOT NULL);
REVOKE SELECT ON zoom_rounds FROM anon, authenticated;

-- ── spectrum_rounds: true_value is the secret ──
DROP POLICY IF EXISTS spectrum_rounds_select ON spectrum_rounds;
CREATE POLICY spectrum_rounds_select ON spectrum_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL AND ended_at IS NOT NULL);
REVOKE SELECT ON spectrum_rounds FROM anon, authenticated;

-- ── pin_rounds: true_lat / true_lng are the secret ──
DROP POLICY IF EXISTS pin_rounds_select ON pin_rounds;
CREATE POLICY pin_rounds_select ON pin_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL AND ended_at IS NOT NULL);
REVOKE SELECT ON pin_rounds FROM anon, authenticated;

-- ── pokerface_hands: is_truth / card_fact / claim_text are the secret ──
-- A hand is directly readable by the client only at reveal/done. Before that the
-- caller must not learn whether the presenter is bluffing; the present + call
-- endpoints serve the non-secret view (card word, claim shown, stakes).
DROP POLICY IF EXISTS pokerface_hands_select ON pokerface_hands;
CREATE POLICY pokerface_hands_select ON pokerface_hands
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (phase IN ('reveal', 'done') OR ended_at IS NOT NULL)
  );
REVOKE SELECT ON pokerface_hands FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- PART C — Party (Sketch + Bluff) tables: same hardening
-- ════════════════════════════════════════════════════════════════════════

-- ── sketch_rounds: word + factoid are the secret ──
-- A guesser must never read the word; the drawer fetches it via the drawer-gated
-- /api/party/sketch/rounds/[id]/words route. Direct reads allowed only post-end.
DROP POLICY IF EXISTS sketch_rounds_select ON sketch_rounds;
CREATE POLICY sketch_rounds_select ON sketch_rounds
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (ended_at IS NOT NULL OR drawer_user_id = auth.uid())
  );
REVOKE SELECT ON sketch_rounds FROM anon, authenticated;

-- ── sketch_guesses: was_correct / points reveal hits live ──
-- A user reads only their own guesses directly; the room view comes from the
-- service-role round route. (Keeps "who guessed right first" off direct reads.)
DROP POLICY IF EXISTS sketch_guesses_select ON sketch_guesses;
CREATE POLICY sketch_guesses_select ON sketch_guesses
  FOR SELECT USING (auth.uid() = user_id);
REVOKE SELECT ON sketch_guesses FROM anon, authenticated;

-- ── bluff_rounds: correct_answer is the secret ──
DROP POLICY IF EXISTS bluff_rounds_select ON bluff_rounds;
CREATE POLICY bluff_rounds_select ON bluff_rounds
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (phase = 'reveal' OR ended_at IS NOT NULL)
  );
REVOKE SELECT ON bluff_rounds FROM anon, authenticated;

-- ── bluff_answers: is_truth + author (user_id) are the secret pre-reveal ──
-- A player may read their OWN answer (to re-show their submission); everyone
-- else's answers + the truth flag reach the client only via the phase-aware
-- service-role round route, which strips is_truth/author until reveal.
DROP POLICY IF EXISTS bluff_answers_select ON bluff_answers;
CREATE POLICY bluff_answers_select ON bluff_answers
  FOR SELECT USING (auth.uid() = user_id);
REVOKE SELECT ON bluff_answers FROM anon, authenticated;

-- ── bluff_votes: keep a player's own vote private to them ──
DROP POLICY IF EXISTS bluff_votes_select ON bluff_votes;
CREATE POLICY bluff_votes_select ON bluff_votes
  FOR SELECT USING (auth.uid() = voter_user_id);
REVOKE SELECT ON bluff_votes FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- PART D — Realtime publication for competitive_responses
-- ════════════════════════════════════════════════════════════════════════
-- The opponent's live score ticks are delivered peer-to-peer via broadcast
-- (lib/competitive/channels.ts), so competitive_responses does NOT need to be in
-- the publication. The own-row RLS would scope it correctly if we ever add it,
-- but we keep it OUT to avoid leaking per-row inserts to non-owners. Intentional.

-- Note: the secret round tables (sabotage/zoom/spectrum/pin/pokerface) remain in
-- the supabase_realtime publication from 054 for low-frequency phase/round-advance
-- ticks. Realtime postgres_changes are ALSO filtered by RLS, so with the policies
-- above a non-owner client subscribed to these tables will receive the row only
-- once it has ended. The sanitized API route remains the source of truth for
-- in-flight content; realtime is purely an "advance happened" nudge.
