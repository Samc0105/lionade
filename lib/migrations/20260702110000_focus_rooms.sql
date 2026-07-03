-- 20260702110000_focus_rooms.sql
-- ============================================================
-- HELD: apply manually (Sam) via the Supabase SQL editor. UNAPPLIED.
--
-- Focus Rooms: bounded body-doubling. A host makes a room, friends join by
-- code, the host starts ONE timed session (25/45/60 min), everyone shares a
-- server-authoritative countdown, and completion pays the SAME solo Focus
-- Lock-In reward (25/50/75 Fangs, ledger type `focus_session`) plus a +15
-- group bonus (`focus_room_bonus`) when 2+ members finish. Sessions end;
-- there are no infinite rooms (5h lazy lobby expiry, party pattern).
--
-- DEPENDENCY (bonus only): the `focus_room_bonus` ledger type is added to the
-- coin_transactions type CHECK by 20260702090000_web_features_ledger_types.sql
-- (also HELD, itself after 20260618130000). Until that lands, the complete
-- route FAILS SOFT: the session still completes and base pay (an already-legal
-- `focus_session` row) still lands, but the +15 bonus is skipped and reported
-- as pending (`bonus_granted` stays false so a later retry grants it).
--
-- Until THIS migration is applied, every /api/focus-rooms/* route detects the
-- missing tables (42P01) and self-disables with honest copy; no page 500s.
--
-- RLS follows the party pattern (migration 20260526230000): SELECT for any
-- authenticated user (rooms are reachable by short code anyway), all writes
-- through the service role inside /api/focus-rooms/* handlers only.

-- ── focus_rooms ───────────────────────────────────────────────────────
-- code uniqueness is enforced by the PARTIAL unique index below (active
-- rooms only), NOT a global UNIQUE: 4-digit codes recycle once a room is
-- done/expired, and the generator (lib/focus-rooms/room-code.ts) collision-
-- checks against lobby/running rooms only. A global UNIQUE would slowly
-- poison the 10k-code pool with dead rooms (latent party_rooms issue we
-- deliberately do not replicate here).
CREATE TABLE IF NOT EXISTS focus_rooms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL,
  host_user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  privacy_mode      text NOT NULL DEFAULT 'friends'
                      CHECK (privacy_mode IN ('open', 'friends', 'closed')),
  duration_minutes  int  NOT NULL CHECK (duration_minutes IN (25, 45, 60)),
  status            text NOT NULL DEFAULT 'lobby'
                      CHECK (status IN ('lobby', 'running', 'done', 'expired')),
  started_at        timestamptz,
  ends_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_focus_rooms_code_active
  ON focus_rooms(code) WHERE status IN ('lobby', 'running');
CREATE INDEX IF NOT EXISTS idx_focus_rooms_host
  ON focus_rooms(host_user_id, created_at DESC);

ALTER TABLE focus_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS focus_rooms_select ON focus_rooms;
CREATE POLICY focus_rooms_select ON focus_rooms
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── focus_room_members ────────────────────────────────────────────────
-- completed:      the member finished the session (server-verified against
--                 ends_at; the compare-and-swap on this flag is the base-pay
--                 idempotency claim).
-- bonus_granted:  the +15 group bonus landed for this member (compare-and-swap
--                 on this flag is the bonus idempotency claim; reverted if the
--                 ledger insert fails so a post-migration retry can grant it).
CREATE TABLE IF NOT EXISTS focus_room_members (
  room_id        uuid NOT NULL REFERENCES focus_rooms(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at      timestamptz NOT NULL DEFAULT now(),
  left_at        timestamptz,
  completed      boolean NOT NULL DEFAULT false,
  bonus_granted  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_focus_room_members_user
  ON focus_room_members(user_id, joined_at DESC);

ALTER TABLE focus_room_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS focus_room_members_select ON focus_room_members;
CREATE POLICY focus_room_members_select ON focus_room_members
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Realtime publication ──────────────────────────────────────────────
-- The room page subscribes postgres_changes on both tables (plus a 3s poll
-- reconciler, party pattern). Wrapped so re-running never fails.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['focus_rooms', 'focus_room_members'];
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
