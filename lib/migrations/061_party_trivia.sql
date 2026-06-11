-- Migration 061: Lionade Party — Trivia (Kahoot-style MCQ race).
--
-- Web-only V1, follows the party suite scope (see migration 051 + IOS_PARITY).
--
-- What this migration adds:
--   1. `trivia_rounds`  — per-round Trivia state (question, 4 shuffled options, secret
--                         correct_index, answer/reveal phase + server-authoritative deadlines)
--   2. `trivia_answers` — one immutable answer per player per round (DB-enforced via PK)
--   3. Realtime publication entries so clients receive phase changes + scoreboard ticks.
--
-- RLS:
--   - Both tables enable RLS (+ FORCE). SELECT is allowed for any authenticated user
--     (rooms are public-ish via 6-char codes; these rows are realtime-broadcast). The
--     secret `correct_index` is stripped at the API layer before reveal, NOT via RLS —
--     same pattern as `bluff_rounds.correct_answer`. INSERT/UPDATE/DELETE only via the
--     service role inside /api/party/* route handlers — no client write policies.
--
-- Realtime:
--   - Tables added to `supabase_realtime` publication so phase transitions (answer ->
--     reveal) and incoming answers reach all clients automatically.

-- ── trivia_rounds ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trivia_rounds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  round_num       int NOT NULL,
  question        text NOT NULL,
  category        text,
  options         jsonb NOT NULL,
  correct_index   int NOT NULL,
  phase           text NOT NULL DEFAULT 'answer',
  started_at      timestamptz NOT NULL DEFAULT now(),
  answer_ends_at  timestamptz,
  reveal_ends_at  timestamptz,
  ended_at        timestamptz,
  UNIQUE (room_id, round_num),
  CONSTRAINT trivia_rounds_phase_chk CHECK (phase IN ('answer', 'reveal'))
);

CREATE INDEX IF NOT EXISTS idx_trivia_rounds_room
  ON trivia_rounds(room_id, round_num DESC);

ALTER TABLE trivia_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE trivia_rounds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trivia_rounds_select ON trivia_rounds;
CREATE POLICY trivia_rounds_select ON trivia_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Column-level REVOKE on the secret correct_index. RLS is row-level only, so a
-- SELECT policy of "auth.uid() IS NOT NULL" lets ANY authenticated user read the
-- whole row — including correct_index — directly via PostgREST (anon key + their
-- JWT) or in realtime payloads, BEFORE the reveal phase. For Trivia the correct
-- index IS the win condition, so that's a real cheat. Revoking column SELECT from
-- the authenticated/anon roles makes the column unreadable through PostgREST and
-- omits it from realtime change payloads, while service_role (supabaseAdmin, used
-- by every API route for scoring/reveal-gating) is unaffected. The API still
-- strips correct_index from answer-phase responses; this is defense in depth that
-- closes the direct-read bypass.
REVOKE SELECT (correct_index) ON trivia_rounds FROM authenticated, anon;

-- ── trivia_answers ────────────────────────────────────────────────────
-- One immutable answer per player per round; the composite PK guarantees at the
-- DB level that a player cannot answer twice.
CREATE TABLE IF NOT EXISTS trivia_answers (
  round_id       uuid NOT NULL REFERENCES trivia_rounds(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  choice_index   int NOT NULL,
  answered_at    timestamptz NOT NULL DEFAULT now(),
  is_correct     boolean,
  points_earned  int NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trivia_answers_round
  ON trivia_answers(round_id);

ALTER TABLE trivia_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trivia_answers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trivia_answers_select ON trivia_answers;
CREATE POLICY trivia_answers_select ON trivia_answers
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Realtime publication ──────────────────────────────────────────────
-- Add tables to supabase_realtime publication so clients receive INSERT/UPDATE
-- events automatically. Wrap each ADD in a DO block so re-running the migration
-- doesn't fail if a table is already in the publication.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'trivia_rounds',
    'trivia_answers'
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
