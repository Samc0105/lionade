-- Migration 018: Track which modes a user has unlocked per material.
--
-- Original model treated one generation = all 7 modes unlocked. We're
-- switching to per-mode unlocks: the user pays the mode price for each
-- mode they want to play, and that unlock persists for the material so
-- they can replay without paying again.
--
-- Backfill: every existing material gets all 7 modes marked as unlocked
-- (so no one loses access to content they've already paid for).

ALTER TABLE ninny_materials
  ADD COLUMN IF NOT EXISTS unlocked_modes TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: existing materials get all 7 modes marked as unlocked
UPDATE ninny_materials
SET unlocked_modes = ARRAY['mcq','flashcards','match','fill','tf','ordering','blitz']
WHERE unlocked_modes = '{}';
