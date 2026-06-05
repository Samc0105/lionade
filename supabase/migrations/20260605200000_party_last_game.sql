-- 20260605200000_party_last_game.sql
--
-- Bucket C symmetry pass (2026-06-05): adds `last_game` to party_rooms so
-- the lobby can surface a "Rematch — same group played Sketchy" CTA when the
-- room returns from a finished game. Today the `current_game` flips to NULL
-- in /api/party/rooms/[code]/end-game when the host returns to lobby; that
-- silently drops the breadcrumb of what was just played. Now we copy it into
-- `last_game` on the way down.
--
-- Why a column rather than deriving from sketch_rounds / bluff_rounds: the
-- lobby cares about "what did this same group last play together" which can
-- span multiple games (Sketchy → lobby → Bluff → lobby → ...). The most
-- recent round of any one game is not the same as "the last game played."
-- A single column is the cheapest source of truth.
--
-- Service-role-only (writes happen via supabaseAdmin in end-game route).
-- No RLS policy needed beyond the existing party_rooms policies — the read
-- path goes through fetchRoomSnapshot which already gates by room code.

ALTER TABLE party_rooms
  ADD COLUMN IF NOT EXISTS last_game TEXT
    CHECK (last_game IN ('sketch', 'bluff', 'pokerface') OR last_game IS NULL);

-- Backfill: any room that has ended OR has a current_game gets that value
-- mirrored so today's existing rooms aren't a blank slate post-deploy. New
-- rooms start with NULL and pick up a value the first time end-game fires.
UPDATE party_rooms
  SET last_game = current_game
  WHERE last_game IS NULL
    AND current_game IS NOT NULL;
