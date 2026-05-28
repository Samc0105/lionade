-- Migration 052: per-player ready state in Lionade Party lobby.
--
-- Adds party_room_players.is_ready (boolean, default false). Players toggle
-- this from the lobby; the host's Start button is disabled until every
-- player is ready. New joiners default to is_ready=false so a player
-- joining mid-lobby forces a quick re-check from everyone.

ALTER TABLE party_room_players
  ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN party_room_players.is_ready IS
  'Lionade Party lobby: per-player ready state. Host can start a game only when all active (left_at IS NULL) players in the room are is_ready=true.';
