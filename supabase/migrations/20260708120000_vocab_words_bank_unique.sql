-- Learn audit P1-1 (2026-07-08): fix vocab Fang-farming + cross-bank false-reject.
--
-- The live unique index `vocab_words_user_pair_word_unique` is on
-- (user_id, source_lang, target_lang, lower(word)). Two problems:
--   1. FARMING: general banks store NULL source_lang/target_lang, and Postgres
--      treats NULLs as DISTINCT, so the SAME word re-inserts into a general
--      bank repeatedly — each insert credits +5 (or +15 self-defined) Fangs.
--      app/api/vocab/words/route.ts relies on a 23505 to block the re-save +
--      re-credit; with NULL langs that 23505 never fires. Farmable.
--   2. CROSS-BANK FALSE-REJECT: because the key omits bank_id, the same word in
--      two different same-language-pair banks trips 23505 → misleading
--      "You already saved this word in this bank".
--
-- Correct key is (user_id, bank_id, lower(word)): bank_id is NOT NULL (no
-- NULL-distinct hole) and per-bank (cross-bank saves allowed). Then the route's
-- existing 23505 handler works exactly as its comment claims.

-- 1. Defensive dedup — collapse any exact duplicates, keeping the lowest id per
--    (user_id, bank_id, lower(word)). Expected a no-op (audit found 0 dupes),
--    but required so the UNIQUE index below can be created.
DELETE FROM vocab_words a
USING vocab_words b
WHERE a.user_id = b.user_id
  AND a.bank_id = b.bank_id
  AND lower(a.word) = lower(b.word)
  AND a.id > b.id;

-- 2. Retire the lang-pair index (the source of BOTH bugs).
DROP INDEX IF EXISTS vocab_words_user_pair_word_unique;

-- 3. Correct per-bank uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS vocab_words_user_bank_word_unique
  ON vocab_words (user_id, bank_id, lower(word));
