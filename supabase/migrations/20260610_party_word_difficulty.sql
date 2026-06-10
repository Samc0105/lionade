-- Sketchy Subjects — difficulty-tiered word selection.
--
-- party_word_lists.difficulty already exists (TEXT NOT NULL DEFAULT 'medium',
-- created in 20260526230000_lionade_party.sql) but carried no CHECK
-- constraint, so any string could land in the column. This migration:
--
--   1. Backfills any row whose difficulty is NULL or outside the three valid
--      tiers using a char_length heuristic:
--        <= 5 chars  -> 'easy'
--        6-8 chars   -> 'medium'
--        9+ chars    -> 'hard'  (multi-word / technical terms land here)
--      Rows seeded from lib/party/word-lists.ts already carry curated tier
--      values and are left untouched. Re-running
--      scripts/seed-party-words.ts restores the curated tier for every word
--      (the upsert is keyed on subject,word and replaces difficulty).
--
--   2. Adds the CHECK ('easy','medium','hard') constraint so future writes
--      can't drift outside the three tiers the candidate picker depends on.
--
-- Consumed by: app/api/party/sketch/rounds/route.ts (one candidate per tier,
-- easy -> medium -> hard) and the drawer's word-picker UI in
-- components/party/SketchView.tsx.

UPDATE party_word_lists
SET difficulty = CASE
  WHEN char_length(word) <= 5 THEN 'easy'
  WHEN char_length(word) <= 8 THEN 'medium'
  ELSE 'hard'
END
WHERE difficulty IS NULL
   OR difficulty NOT IN ('easy', 'medium', 'hard');

ALTER TABLE party_word_lists
  DROP CONSTRAINT IF EXISTS party_word_lists_difficulty_check;

ALTER TABLE party_word_lists
  ADD CONSTRAINT party_word_lists_difficulty_check
  CHECK (difficulty IN ('easy', 'medium', 'hard'));
