-- Lionade Party V2 — room privacy + named rooms + mid-game join queue +
-- request-to-join + spectator + lobby chat + past lobbies history.
--
-- Web-only feature. Schema changes are additive (no destructive renames) and
-- carry safe defaults so existing rooms keep playing without backfill.
--
-- New columns:
--   party_rooms.privacy_mode        (default 'open')
--   party_rooms.display_name        (nullable)
--   party_rooms.dismissed_at        (set when host closes the room)
--   party_room_players.is_pending_round (mid-game join queue flag)
--   party_room_players.is_spectator     (caller chose spectator)
--
-- New tables:
--   party_join_requests   — pending/approved/declined join requests
--   party_lobby_chat      — message log between rounds
--
-- Realtime publication entries for the two new tables so clients can
-- subscribe (broadcasts still carry the live ephemeral events; row
-- inserts back the persistent log).

-- ── party_rooms additions ─────────────────────────────────────────────
ALTER TABLE party_rooms
  ADD COLUMN IF NOT EXISTS privacy_mode TEXT NOT NULL DEFAULT 'open'
    CHECK (privacy_mode IN ('open', 'friends', 'closed'));

ALTER TABLE party_rooms
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE party_rooms
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- ── party_room_players additions ─────────────────────────────────────
ALTER TABLE party_room_players
  ADD COLUMN IF NOT EXISTS is_pending_round BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE party_room_players
  ADD COLUMN IF NOT EXISTS is_spectator BOOLEAN NOT NULL DEFAULT false;

-- ── party_join_requests ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_join_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code           TEXT NOT NULL,
  requester_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  note                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'declined', 'expired', 'cancelled')),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (room_code, requester_user_id, requested_at)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_room_pending
  ON party_join_requests (room_code, status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_join_requests_requester
  ON party_join_requests (requester_user_id, requested_at DESC);

ALTER TABLE party_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_join_requests_select_self ON party_join_requests;
CREATE POLICY party_join_requests_select_self ON party_join_requests
  FOR SELECT USING (auth.uid() = requester_user_id);

DROP POLICY IF EXISTS party_join_requests_select_host ON party_join_requests;
CREATE POLICY party_join_requests_select_host ON party_join_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM party_rooms r
      WHERE r.code = party_join_requests.room_code
        AND r.host_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS party_join_requests_insert_self ON party_join_requests;
CREATE POLICY party_join_requests_insert_self ON party_join_requests
  FOR INSERT WITH CHECK (auth.uid() = requester_user_id);

DROP POLICY IF EXISTS party_join_requests_update_host ON party_join_requests;
CREATE POLICY party_join_requests_update_host ON party_join_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM party_rooms r
      WHERE r.code = party_join_requests.room_code
        AND r.host_user_id = auth.uid()
    )
  );

-- ── party_lobby_chat ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_lobby_chat (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code   TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobby_chat_room_time
  ON party_lobby_chat (room_code, created_at DESC);

ALTER TABLE party_lobby_chat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_lobby_chat_select_members ON party_lobby_chat;
CREATE POLICY party_lobby_chat_select_members ON party_lobby_chat
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM party_rooms r
      JOIN party_room_players p ON p.room_id = r.id
      WHERE r.code = party_lobby_chat.room_code
        AND p.user_id = auth.uid()
        AND p.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS party_lobby_chat_insert_members ON party_lobby_chat;
CREATE POLICY party_lobby_chat_insert_members ON party_lobby_chat
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM party_rooms r
      JOIN party_room_players p ON p.room_id = r.id
      WHERE r.code = party_lobby_chat.room_code
        AND p.user_id = auth.uid()
        AND p.left_at IS NULL
    )
  );

-- ── Realtime publication ─────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['party_join_requests', 'party_lobby_chat'];
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
