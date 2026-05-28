-- Migration 053: per-player topic preferences in Lionade Party.
--
-- Each player picks up to 2 topics they want to draw/guess. Word picker
-- weights subjects by overlap — a subject picked by 4 players is 4x as
-- likely to surface as a subject picked by 1.
--
-- Defaults to empty array; players with no picks don't contribute to the
-- weighting (their effective preference is "any subject"). If literally
-- nobody picked anything, the picker falls back to uniform across all
-- subjects.

ALTER TABLE party_room_players
  ADD COLUMN IF NOT EXISTS selected_subjects text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN party_room_players.selected_subjects IS
  'Lionade Party: per-player topic picks (up to 2). Weighted multiset across active players drives the sketch word-picker.';
