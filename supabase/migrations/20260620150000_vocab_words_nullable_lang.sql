-- Migration: let GENERAL (non-language) vocab banks save words.
--
-- BUG: vocab_words.source_lang / target_lang were NOT NULL — a holdover from V1
-- when vocab was language-only. V2 added general banks (kind='general') whose
-- words have NO language, and POST /api/vocab/words inserts source_lang =
-- target_lang = NULL for them. The NOT NULL constraint rejected every such
-- insert, so "Lock it in" on a general bank always failed with "Couldn't save"
-- (confirmed: 4 general banks existed with 0 words ever saved). The earlier V2
-- word_banks migration intended to relax these but never did (see the note in
-- 20260603164500_demo_account.sql).
--
-- FIX: drop NOT NULL on both. Safe:
--   * The ISO-2 regex CHECKs (source_lang/target_lang ~ '^[a-z]{2}$') are
--     satisfied when the value is NULL (a CHECK passes unless it evaluates to
--     FALSE), so language banks are unaffected and general banks (NULL) pass.
--   * vocab_words_has_answer still guarantees translation OR term_definition.
--   * No data change; language-bank rows keep their non-null pair.

alter table public.vocab_words alter column source_lang drop not null;
alter table public.vocab_words alter column target_lang drop not null;
