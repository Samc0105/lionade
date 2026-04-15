-- Migration 020: Update level calculation to progressive curve
--
-- Old formula: level = FLOOR(xp / 1000) + 1  (linear, 1000 XP per level)
-- New formula: exponential growth, BASE=100, GROWTH=1.055
--   XP for level N→N+1 = FLOOR(100 * 1.055^N)
--   Takes ~5 years at 5h/week to reach max level (100)
--
-- This trigger recalculates `level` whenever `xp` changes.

CREATE OR REPLACE FUNCTION calc_level_from_xp(total_xp INTEGER)
RETURNS INTEGER AS $$
DECLARE
  lvl INTEGER := 1;
  remaining INTEGER := total_xp;
  needed INTEGER;
BEGIN
  WHILE lvl < 100 LOOP
    needed := FLOOR(100 * POWER(1.055, lvl - 1));
    IF remaining < needed THEN
      EXIT;
    END IF;
    remaining := remaining - needed;
    lvl := lvl + 1;
  END LOOP;
  RETURN lvl;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update the trigger function to use the new progressive formula
CREATE OR REPLACE FUNCTION on_profile_xp_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.xp IS DISTINCT FROM OLD.xp THEN
    NEW.level := calc_level_from_xp(COALESCE(NEW.xp, 0));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill all existing profiles with the new level calculation
UPDATE profiles SET level = calc_level_from_xp(COALESCE(xp, 0));
