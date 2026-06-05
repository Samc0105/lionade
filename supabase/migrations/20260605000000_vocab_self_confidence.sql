-- Vocab Self-Confidence: user-override for word confidence level
--
-- WHY:
--   The Excel-vibe Word Bank list wants a "How confident are you?" column
--   where users can manually flag words as 'confident', 'shaky', or
--   'struggling' — independent of the algorithm-derived accuracy score.
--   This lets users self-tag words they FEEL shaky on even if stats say
--   otherwise (and vice versa). The column is nullable: NULL means "derive
--   from accuracy" (default); a non-null value means "user overrode."
--
-- WHAT THIS DOES:
--   1. Creates ENUM type 'vocab_confidence' with values:
--      'confident', 'shaky', 'struggling'.
--   2. Adds nullable column 'self_confidence' of type vocab_confidence to
--      vocab_words, default NULL.
--   3. Adds a partial index on (user_id, bank_id, self_confidence) WHERE
--      self_confidence IS NOT NULL — cheap filter-by-confidence queries
--      without bloating the index for the majority of NULL rows.
--
-- RLS NOTE:
--   RLS is already enabled on vocab_words. We do NOT touch policies or
--   table-level grants. The PATCH endpoint for this column runs via
--   supabaseAdmin (service role), so authenticated does NOT need a
--   column-level UPDATE grant — default grants are sufficient.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

begin;

-- ---------------------------------------------------------------------------
-- 1. ENUM type: vocab_confidence
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vocab_confidence') then
    create type vocab_confidence as enum ('confident', 'shaky', 'struggling');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Column: vocab_words.self_confidence
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vocab_words'
      and column_name = 'self_confidence'
  ) then
    alter table vocab_words
      add column self_confidence vocab_confidence default null;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Partial index: filter-by-confidence queries
-- ---------------------------------------------------------------------------
--
-- Only indexes rows where self_confidence IS NOT NULL. Most rows will be NULL
-- (user hasn't overridden), so the index stays small. Queries like:
--   SELECT * FROM vocab_words
--   WHERE user_id = ? AND bank_id = ? AND self_confidence = 'struggling'
-- will hit this index efficiently.

create index if not exists vocab_words_user_bank_self_confidence_idx
  on vocab_words (user_id, bank_id, self_confidence)
  where self_confidence is not null;

commit;
