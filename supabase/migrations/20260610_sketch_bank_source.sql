-- Sketchy Subjects — Word Bank as a drawing-word source.
--
-- WHY:
--   Sketchy rounds have always drawn their prompt words from curated subjects
--   ("biology", "history", ...) via party_word_lists / the inline stub. This
--   migration lets a player point a sketch round at one of THEIR OWN Word Banks
--   (vocab_banks, see 20260603143154_word_banks.sql) so a bank like
--   "AWS Security Specialty" or "Spanish 101" becomes the drawing-word source.
--
--   The bank choice rides inside party_room_players.selected_subjects (a
--   text[]) as the token "bank:<bankUuid>" alongside any bare curated subjects.
--   No schema change is needed on party_room_players — only sketch_rounds needs
--   to record WHICH source produced the round's words so the drawer payload,
--   reroll, and any future analytics can tell curated rounds from bank rounds.
--
-- WHAT THIS DOES (idempotent — IF NOT EXISTS + drop-then-add CHECK):
--   1. sketch_rounds.source_kind   text not null default 'curated'
--        CHECK in ('curated','bank') — which pool produced candidate_words.
--   2. sketch_rounds.source_bank_id uuid references vocab_banks(id)
--        on delete set null — for bank rounds, the bank the words came from.
--        ON DELETE SET NULL so deleting a bank never orphans / blocks a
--        historical round row.
--   3. sketch_rounds.rerolled      boolean not null default false
--        — the drawer may re-pick a round's candidate_words exactly once;
--        this flag is the one-shot guard (POST .../reroll sets it true).
--
-- For a bank round the route sets: subject = the bank NAME (display label),
-- source_kind = 'bank', source_bank_id = <bank uuid>. Curated rounds keep
-- source_kind = 'curated' and source_bank_id NULL (the default).
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

alter table sketch_rounds
  add column if not exists source_kind    text not null default 'curated';

alter table sketch_rounds
  add column if not exists source_bank_id uuid references vocab_banks(id) on delete set null;

alter table sketch_rounds
  add column if not exists rerolled       boolean not null default false;

-- Re-creatable CHECK on source_kind (drop-then-add so re-running is safe).
alter table sketch_rounds
  drop constraint if exists sketch_rounds_source_kind_check;

alter table sketch_rounds
  add constraint sketch_rounds_source_kind_check
  check (source_kind in ('curated', 'bank'));
