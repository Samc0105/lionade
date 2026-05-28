-- Migration 051: Lionade Party — multiplayer game suite (Sketchy Subjects + Bluff Trivia).
--
-- Web-only V1 per CEO scope override 2026-05-26. iOS port deferred (see IOS_PARITY).
-- Spec locked at ~/.claude/projects/-Users-samc-Desktop-lionade/memory/project_lionade_party.md.
--
-- What this migration adds:
--   1. `party_rooms` — the lobby/room (6-char code, host, status, current_game, settings jsonb)
--   2. `party_room_players` — who is in each room + score
--   3. `sketch_rounds` / `sketch_strokes` / `sketch_guesses` — per-round Sketchy Subjects state
--   4. `bluff_rounds` / `bluff_answers` / `bluff_votes` — per-round Bluff Trivia state
--   5. `party_word_lists` — curated drawing prompts (seeded by scripts/seed-party-words.ts)
--   6. Realtime publication entries so the client can subscribe to live updates.
--
-- RLS:
--   - All tables enable RLS. SELECT is allowed for any authenticated user (rooms are
--     public-ish via 6-char codes). INSERT/UPDATE/DELETE only via service role inside
--     /api/party/* route handlers — no client policies for writes.
--
-- Realtime:
--   - Stroke broadcasts go through Supabase Realtime `payload` channels for low latency
--     (not table inserts). The server batches strokes into `sketch_strokes` every ~500ms
--     so late-joiners can replay.
--   - Tables added to `supabase_realtime` publication so phase changes, joins, and
--     scoreboard ticks reach all clients automatically.

-- ── party_rooms ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,
  host_user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'lobby',
  current_game  text,
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_party_rooms_code
  ON party_rooms(code) WHERE status <> 'ended';
CREATE INDEX IF NOT EXISTS idx_party_rooms_host
  ON party_rooms(host_user_id, created_at DESC);

ALTER TABLE party_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_rooms_select ON party_rooms;
CREATE POLICY party_rooms_select ON party_rooms
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── party_room_players ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_room_players (
  room_id     uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score       int NOT NULL DEFAULT 0,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  left_at     timestamptz,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_party_room_players_user
  ON party_room_players(user_id, joined_at DESC);

ALTER TABLE party_room_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_room_players_select ON party_room_players;
CREATE POLICY party_room_players_select ON party_room_players
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── sketch_rounds ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sketch_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  round_num      int NOT NULL,
  drawer_user_id uuid NOT NULL REFERENCES profiles(id),
  word           text NOT NULL,
  subject        text NOT NULL,
  factoid        text,
  duration_sec   int NOT NULL DEFAULT 90,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  UNIQUE (room_id, round_num)
);

CREATE INDEX IF NOT EXISTS idx_sketch_rounds_room
  ON sketch_rounds(room_id, round_num);

ALTER TABLE sketch_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sketch_rounds_select ON sketch_rounds;
CREATE POLICY sketch_rounds_select ON sketch_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── sketch_strokes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sketch_strokes (
  id          bigserial PRIMARY KEY,
  round_id    uuid NOT NULL REFERENCES sketch_rounds(id) ON DELETE CASCADE,
  stroke_num  int NOT NULL,
  color       text NOT NULL,
  size        int NOT NULL,
  points      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sketch_strokes_round
  ON sketch_strokes(round_id, stroke_num);

ALTER TABLE sketch_strokes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sketch_strokes_select ON sketch_strokes;
CREATE POLICY sketch_strokes_select ON sketch_strokes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── sketch_guesses ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sketch_guesses (
  id             bigserial PRIMARY KEY,
  round_id       uuid NOT NULL REFERENCES sketch_rounds(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES profiles(id),
  guess          text NOT NULL,
  was_correct    boolean NOT NULL,
  was_close      boolean NOT NULL DEFAULT false,
  points_earned  int NOT NULL DEFAULT 0,
  guessed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sketch_guesses_round
  ON sketch_guesses(round_id, guessed_at);

ALTER TABLE sketch_guesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sketch_guesses_select ON sketch_guesses;
CREATE POLICY sketch_guesses_select ON sketch_guesses
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── bluff_rounds ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bluff_rounds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  round_num       int NOT NULL,
  question        text NOT NULL,
  correct_answer  text NOT NULL,
  category        text,
  phase           text NOT NULL DEFAULT 'write',
  started_at      timestamptz NOT NULL DEFAULT now(),
  write_ends_at   timestamptz,
  vote_ends_at    timestamptz,
  ended_at        timestamptz,
  UNIQUE (room_id, round_num)
);

CREATE INDEX IF NOT EXISTS idx_bluff_rounds_room
  ON bluff_rounds(room_id, round_num);

ALTER TABLE bluff_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bluff_rounds_select ON bluff_rounds;
CREATE POLICY bluff_rounds_select ON bluff_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── bluff_answers ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bluff_answers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   uuid NOT NULL REFERENCES bluff_rounds(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id),
  text       text NOT NULL,
  is_truth   boolean NOT NULL DEFAULT false,
  UNIQUE (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bluff_answers_round
  ON bluff_answers(round_id);

ALTER TABLE bluff_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bluff_answers_select ON bluff_answers;
CREATE POLICY bluff_answers_select ON bluff_answers
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── bluff_votes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bluff_votes (
  round_id        uuid NOT NULL REFERENCES bluff_rounds(id) ON DELETE CASCADE,
  voter_user_id   uuid NOT NULL REFERENCES profiles(id),
  answer_id       uuid NOT NULL REFERENCES bluff_answers(id) ON DELETE CASCADE,
  voted_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, voter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_bluff_votes_round
  ON bluff_votes(round_id);

ALTER TABLE bluff_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bluff_votes_select ON bluff_votes;
CREATE POLICY bluff_votes_select ON bluff_votes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── party_word_lists ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_word_lists (
  id          bigserial PRIMARY KEY,
  subject     text NOT NULL,
  word        text NOT NULL,
  difficulty  text NOT NULL DEFAULT 'medium',
  factoid     text NOT NULL,
  UNIQUE (subject, word)
);

CREATE INDEX IF NOT EXISTS idx_party_word_lists_subject
  ON party_word_lists(subject, difficulty);

ALTER TABLE party_word_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_word_lists_select ON party_word_lists;
CREATE POLICY party_word_lists_select ON party_word_lists
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Realtime publication ──────────────────────────────────────────────
-- Add tables to supabase_realtime publication so clients receive INSERT/UPDATE
-- events automatically. Wrap each ADD in a DO block so re-running the migration
-- doesn't fail if a table is already in the publication.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'party_rooms',
    'party_room_players',
    'sketch_rounds',
    'sketch_strokes',
    'sketch_guesses',
    'bluff_rounds',
    'bluff_answers',
    'bluff_votes'
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
