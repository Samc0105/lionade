-- Session lifecycle schema V2 — unified primitives for join/play/round-end/leave
-- across ALL game modes (Sketchy / Bluff / Trust Issues / Arena / Blitz /
-- Mastery / Daily Drill / Quiz / Roardle / Timeline / Flashcards).
--
-- WHY:
--   Every game mode has the same lifecycle (join → play → round end →
--   continue or leave) with the same interrupts (refresh, accidental nav,
--   network drop, AFK, backgrounded tab). Today each mode hand-rolls its
--   own answer, none of them agree, and the user-visible bugs all stem
--   from this: drawer reloads mid-round and the round is bricked,
--   competitive match player AFK-quits and the opponent waits 90s for a
--   timeout, mastery session loses the in-flight text input on a refresh,
--   etc. The fix is ONE foundational primitive (a `profiles.active_session`
--   pointer + a `presence_heartbeats` table + a reaper RPC) plus thin
--   per-mode resume tables. Every mode then implements the same 4-step
--   shape:
--     enter  → call set_active_session(...)
--     tick   → call ping_presence(...) every 10s
--     resume → on mount, read profiles.active_session, route to mode
--     leave  → call clear_active_session(...)
--
-- WHAT THIS DOES:
--   1. `profiles.active_session jsonb` — the universal pointer. Single
--      source of truth for "where is this user right now." GIN-indexed for
--      reverse lookups (find all users in room ABCD). Column-level UPDATE
--      revoked so user JWTs cannot mutate directly — only SECURITY DEFINER
--      RPCs (set/clear_active_session) and the service role can write.
--      Otherwise a client could pin themselves into a non-existent match
--      to dodge match-find queues or fake presence.
--   2. `presence_heartbeats` — last_ping_at per user. Driven by
--      `ping_presence` RPC every 10s during an active session. The reaper
--      cron scans this table every 30s for users with `last_ping_at <
--      now() - 60s` and clears their active_session + removes them from
--      any party_room_players row matching the stale session_id. The
--      heartbeat row mirrors active_session.type/id at ping time so the
--      reaper doesn't have to re-read jsonb for every candidate.
--   3. `sketch_rounds.phase` + `winner_user_id` + `celebrating_started_at`
--      — promotes the V1 broadcast-driven "celebrating" phase to a
--      persisted DB column so reload-during-celebration works. (See
--      Daily/2026-06-04.md "Design call I made vs the literal spec" — the
--      V1 was deliberately broadcast-only with the schema upgrade flagged
--      for V2; this migration is that V2.) Backfill marks ended rounds as
--      phase='ended' and live rounds as phase='drawing'.
--   4. `party_round_votes` — generic table for the post-round vote
--      mechanic ("Play again" vs "Back to lobby"). Round-kind tagged
--      (sketch | bluff | pokerface) so all three party games share one
--      table instead of three near-identical ones. round_id is NOT
--      foreign-keyed (round_kind picks which table it belongs to) to
--      avoid 3-way polymorphism gymnastics; uniqueness on (round_id,
--      user_id) prevents double-voting per round and an UPDATE policy
--      lets a user change their vote within the window.
--   5. Tier 3 — three resumable solo-mode state tables:
--      `mastery_session_state` (in-flight question + partial text input),
--      `daily_drill_progress` (answered question ids + correct count for
--      a given drill_date), and `quiz_session_state` (generic jsonb
--      bucket for /quiz, /games/blitz, /games/roardle, /games/timeline,
--      and flashcards — game_type discriminator + flexible jsonb state).
--      Owner-only RLS; service role reads for analytics. last_active_at
--      indexed DESC for "resume your last session" landing.
--   6. Four RPCs (all SECURITY DEFINER with caller-id checks):
--      - `ping_presence(p_user_id, p_type, p_id)` — upserts the heartbeat
--        row. Caller-id check: auth.uid() = p_user_id OR service_role.
--      - `reap_afk_presence()` — service_role only. Finds stale
--        heartbeats and clears their active_session + leaves any party
--        room they were in. Returns count of reaped users. Called by
--        Vercel cron / Supabase edge function every 30s.
--      - `set_active_session(p_user_id, p_type, p_id, p_role)` — sets
--        the pointer + writes initial heartbeat. Caller-id check.
--      - `clear_active_session(p_user_id)` — clears pointer + removes
--        heartbeat row. Caller-id check.
--
-- DESIGN NOTES:
--   - The active_session jsonb shape is NOT enforced via a CHECK
--     constraint. Shape (see RPC source for canonical):
--         { type: 'party_room' | 'arena_match' | 'competitive_match'
--                 | 'mastery_session' | 'daily_drill' | 'quiz',
--           id: string,
--           joined_at: string (ISO),
--           role?: 'host' | 'player' | 'drawer' | 'guesser' | 'knower'
--                  | 'reader' }
--     A CHECK on the jsonb shape was considered and rejected: the type
--     and role enums will grow as we add modes (Trust Issues, future
--     casino games, etc.), and a schema migration per new mode is the
--     wrong friction. The RPCs validate `p_type` against the enum on
--     write — that's where the type discipline lives.
--   - party_round_votes.room_code is denormalized from
--     party_rooms.code (no FK) so the room_code index serves "show me
--     all votes in this room" without joining through round → room.
--     SELECT RLS still gates by membership via party_room_players.
--   - Idempotent throughout (IF NOT EXISTS, ON CONFLICT, DROP POLICY
--     IF EXISTS). Re-running is safe.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. profiles.active_session jsonb — universal pointer
-- ---------------------------------------------------------------------------

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active_session jsonb;

COMMENT ON COLUMN profiles.active_session IS
  'Single source of truth for where the user is right now. Shape: '
  '{ type, id, joined_at, role? }. Written ONLY by set_active_session / '
  'clear_active_session / reap_afk_presence RPCs. NULL = user not in any '
  'active session.';

CREATE INDEX IF NOT EXISTS idx_profiles_active_session
  ON profiles USING GIN (active_session);

-- Column-level revoke: users cannot UPDATE this column from a JWT, even
-- though they can UPDATE other profile columns (display_name etc.). Only
-- the SECURITY DEFINER RPCs + service_role may mutate.
REVOKE UPDATE (active_session) ON profiles FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. presence_heartbeats — last_ping_at per user
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS presence_heartbeats (
  user_id              uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  last_ping_at         timestamptz NOT NULL DEFAULT now(),
  active_session_type  text,
  active_session_id    text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presence_heartbeats_active_session_idx
  ON presence_heartbeats (active_session_type, active_session_id, last_ping_at DESC);

CREATE INDEX IF NOT EXISTS presence_heartbeats_stale_idx
  ON presence_heartbeats (last_ping_at)
  WHERE active_session_type IS NOT NULL;

ALTER TABLE presence_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS presence_heartbeats_select_own ON presence_heartbeats;
CREATE POLICY presence_heartbeats_select_own ON presence_heartbeats
  FOR SELECT USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies for end users — all writes flow
-- through the RPCs below (which run as SECURITY DEFINER and bypass RLS).

-- ---------------------------------------------------------------------------
-- 3. sketch_rounds phase columns — promote V1 broadcast phase to DB
-- ---------------------------------------------------------------------------

ALTER TABLE sketch_rounds
  ADD COLUMN IF NOT EXISTS phase text DEFAULT 'select_word'
    CHECK (phase IN ('select_word', 'drawing', 'celebrating', 'reveal', 'ended')),
  ADD COLUMN IF NOT EXISTS winner_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS celebrating_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sketch_rounds_phase
  ON sketch_rounds (room_id, phase)
  WHERE phase <> 'ended';

-- Backfill (idempotent — re-running just no-ops because phase already set).
UPDATE sketch_rounds
   SET phase = 'ended'
 WHERE ended_at IS NOT NULL
   AND phase = 'select_word';

UPDATE sketch_rounds
   SET phase = 'drawing'
 WHERE ended_at IS NULL
   AND phase = 'select_word';

COMMENT ON COLUMN sketch_rounds.phase IS
  'Persisted round phase. V2 upgrade from V1 broadcast-only celebration. '
  'See migrations/20260604_session_lifecycle.sql header.';

-- ---------------------------------------------------------------------------
-- 4. party_round_votes — generic post-round vote table (sketch/bluff/pokerface)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS party_round_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    uuid NOT NULL,
  round_kind  text NOT NULL CHECK (round_kind IN ('sketch', 'bluff', 'pokerface')),
  room_code   text NOT NULL,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote_kind   text NOT NULL CHECK (vote_kind IN ('play_again', 'back_to_lobby')),
  voted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS party_round_votes_round_idx
  ON party_round_votes (round_id);

CREATE INDEX IF NOT EXISTS party_round_votes_room_idx
  ON party_round_votes (room_code, voted_at DESC);

ALTER TABLE party_round_votes ENABLE ROW LEVEL SECURITY;

-- SELECT: a user can read all votes for a round IF they're a member of
-- the room that round belongs to. We can't FK round_id (polymorphic), so
-- membership is checked via party_room_players JOIN on room_code →
-- party_rooms.code → party_room_players.room_id. The join is one
-- nested EXISTS — Postgres handles this efficiently with the room_code
-- index above + the existing party_room_players (room_id, user_id) PK.
DROP POLICY IF EXISTS party_round_votes_select ON party_round_votes;
CREATE POLICY party_round_votes_select ON party_round_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM party_rooms pr
        JOIN party_room_players prp ON prp.room_id = pr.id
       WHERE pr.code = party_round_votes.room_code
         AND prp.user_id = auth.uid()
    )
  );

-- INSERT: user can only insert their own votes.
DROP POLICY IF EXISTS party_round_votes_insert ON party_round_votes;
CREATE POLICY party_round_votes_insert ON party_round_votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE: user can change their own vote (within whatever window the
-- app enforces — DB allows it indefinitely; UI gates closure).
DROP POLICY IF EXISTS party_round_votes_update ON party_round_votes;
CREATE POLICY party_round_votes_update ON party_round_votes
  FOR UPDATE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. mastery_session_state — resumable Mastery Mode state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mastery_session_state (
  user_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id          uuid NOT NULL,
  current_question_id uuid,
  partial_answer      text,
  answered_count      int NOT NULL DEFAULT 0,
  correct_count       int NOT NULL DEFAULT 0,
  last_active_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS mastery_session_state_user_active_idx
  ON mastery_session_state (user_id, last_active_at DESC);

ALTER TABLE mastery_session_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mastery_session_state_select ON mastery_session_state;
CREATE POLICY mastery_session_state_select ON mastery_session_state
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS mastery_session_state_insert ON mastery_session_state;
CREATE POLICY mastery_session_state_insert ON mastery_session_state
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS mastery_session_state_update ON mastery_session_state;
CREATE POLICY mastery_session_state_update ON mastery_session_state
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS mastery_session_state_delete ON mastery_session_state;
CREATE POLICY mastery_session_state_delete ON mastery_session_state
  FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. daily_drill_progress — resumable Daily Drill state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_drill_progress (
  user_id               uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  drill_date            date NOT NULL,
  answered_question_ids uuid[] NOT NULL DEFAULT '{}',
  correct_count         int NOT NULL DEFAULT 0,
  partial_answer        text,
  last_active_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, drill_date)
);

CREATE INDEX IF NOT EXISTS daily_drill_progress_user_active_idx
  ON daily_drill_progress (user_id, last_active_at DESC);

ALTER TABLE daily_drill_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_drill_progress_select ON daily_drill_progress;
CREATE POLICY daily_drill_progress_select ON daily_drill_progress
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS daily_drill_progress_insert ON daily_drill_progress;
CREATE POLICY daily_drill_progress_insert ON daily_drill_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS daily_drill_progress_update ON daily_drill_progress;
CREATE POLICY daily_drill_progress_update ON daily_drill_progress
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS daily_drill_progress_delete ON daily_drill_progress;
CREATE POLICY daily_drill_progress_delete ON daily_drill_progress
  FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. quiz_session_state — generic solo-game state (quiz/blitz/roardle/timeline/flashcards)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quiz_session_state (
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_type      text NOT NULL CHECK (game_type IN ('quiz', 'blitz', 'roardle', 'timeline', 'flashcards')),
  state          jsonb NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_type)
);

CREATE INDEX IF NOT EXISTS quiz_session_state_user_active_idx
  ON quiz_session_state (user_id, last_active_at DESC);

ALTER TABLE quiz_session_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_session_state_select ON quiz_session_state;
CREATE POLICY quiz_session_state_select ON quiz_session_state
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS quiz_session_state_insert ON quiz_session_state;
CREATE POLICY quiz_session_state_insert ON quiz_session_state
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS quiz_session_state_update ON quiz_session_state;
CREATE POLICY quiz_session_state_update ON quiz_session_state
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS quiz_session_state_delete ON quiz_session_state;
CREATE POLICY quiz_session_state_delete ON quiz_session_state
  FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------------

-- ping_presence(p_user_id, p_type, p_id) — heartbeat tick every 10s
-- during an active session. Caller-id check: only the user themselves
-- (or service_role) can ping for a given user_id. Validates p_type
-- against the active_session.type enum.
CREATE OR REPLACE FUNCTION ping_presence(
  p_user_id uuid,
  p_type    text,
  p_id      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller-id gate. auth.uid() is NULL for service_role calls.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'ping_presence: caller % cannot ping for user %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_type NOT IN (
    'party_room', 'arena_match', 'competitive_match',
    'mastery_session', 'daily_drill', 'quiz'
  ) THEN
    RAISE EXCEPTION 'ping_presence: unknown session type %', p_type
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO presence_heartbeats (
    user_id, last_ping_at, active_session_type, active_session_id, updated_at
  )
  VALUES (p_user_id, now(), p_type, p_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_ping_at        = now(),
        active_session_type = EXCLUDED.active_session_type,
        active_session_id   = EXCLUDED.active_session_id,
        updated_at          = now();
END;
$$;

REVOKE ALL ON FUNCTION ping_presence(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION ping_presence(uuid, text, text) TO authenticated, service_role;

-- reap_afk_presence() — service_role only. Sweeps stale heartbeats
-- (last_ping_at < now() - 60s), clears profiles.active_session for those
-- users, and removes them from any party_room_players row matching the
-- session_id (so a ghost host doesn't block the room). Returns the
-- count of reaped users. Called by Vercel cron / Supabase edge function
-- every 30 seconds.
CREATE OR REPLACE FUNCTION reap_afk_presence()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reaped int := 0;
BEGIN
  -- service_role only. auth.uid() is NULL when called as service_role;
  -- a regular JWT call would have a non-null uid → reject.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'reap_afk_presence: service_role only'
      USING ERRCODE = '42501';
  END IF;

  WITH stale AS (
    SELECT user_id, active_session_type, active_session_id
      FROM presence_heartbeats
     WHERE last_ping_at < now() - interval '60 seconds'
       AND active_session_type IS NOT NULL
  ),
  cleared_profiles AS (
    UPDATE profiles p
       SET active_session = NULL
      FROM stale s
     WHERE p.id = s.user_id
    RETURNING p.id
  ),
  left_rooms AS (
    -- For party_room sessions, mark the player as left in
    -- party_room_players. The session_id IS the room code (per
    -- set_active_session shape), so we join code → id.
    UPDATE party_room_players prp
       SET left_at = now()
      FROM stale s
      JOIN party_rooms pr ON pr.code = s.active_session_id
     WHERE s.active_session_type = 'party_room'
       AND prp.room_id = pr.id
       AND prp.user_id = s.user_id
       AND prp.left_at IS NULL
    RETURNING prp.user_id
  ),
  reaped_heartbeats AS (
    UPDATE presence_heartbeats h
       SET active_session_type = NULL,
           active_session_id   = NULL,
           updated_at          = now()
      FROM stale s
     WHERE h.user_id = s.user_id
    RETURNING h.user_id
  )
  SELECT count(*) INTO v_reaped FROM cleared_profiles;

  RETURN v_reaped;
END;
$$;

REVOKE ALL ON FUNCTION reap_afk_presence() FROM public;
GRANT EXECUTE ON FUNCTION reap_afk_presence() TO service_role;

-- set_active_session(p_user_id, p_type, p_id, p_role) — sets the
-- profiles.active_session pointer + writes the initial heartbeat in one
-- transaction. Called on join. Caller-id gate.
CREATE OR REPLACE FUNCTION set_active_session(
  p_user_id uuid,
  p_type    text,
  p_id      text,
  p_role    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'set_active_session: caller % cannot set for user %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_type NOT IN (
    'party_room', 'arena_match', 'competitive_match',
    'mastery_session', 'daily_drill', 'quiz'
  ) THEN
    RAISE EXCEPTION 'set_active_session: unknown session type %', p_type
      USING ERRCODE = '22023';
  END IF;

  v_session := jsonb_build_object(
    'type', p_type,
    'id', p_id,
    'joined_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  IF p_role IS NOT NULL THEN
    v_session := v_session || jsonb_build_object('role', p_role);
  END IF;

  UPDATE profiles
     SET active_session = v_session
   WHERE id = p_user_id;

  INSERT INTO presence_heartbeats (
    user_id, last_ping_at, active_session_type, active_session_id, updated_at
  )
  VALUES (p_user_id, now(), p_type, p_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_ping_at        = now(),
        active_session_type = EXCLUDED.active_session_type,
        active_session_id   = EXCLUDED.active_session_id,
        updated_at          = now();
END;
$$;

REVOKE ALL ON FUNCTION set_active_session(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION set_active_session(uuid, text, text, text) TO authenticated, service_role;

-- clear_active_session(p_user_id) — called on explicit leave OR on
-- game end. Clears the profile pointer + removes the heartbeat row.
-- Caller-id gate.
CREATE OR REPLACE FUNCTION clear_active_session(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'clear_active_session: caller % cannot clear for user %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
     SET active_session = NULL
   WHERE id = p_user_id;

  DELETE FROM presence_heartbeats WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION clear_active_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION clear_active_session(uuid) TO authenticated, service_role;

COMMIT;
