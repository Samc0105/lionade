-- Vocab V1 schema: user-curated vocabulary cards for the /learn language-
-- learning surface, plus per-language-pair streak tracking.
--
-- PATH DECISION: Path A — new `vocab_words` table (NOT extending
-- `class_flashcards`).
--
-- WHY Path A:
--   `class_flashcards` is a class-scoped, AI-generated, fact-shaped Q/A card
--   produced fire-and-forget from study notes (see lib/class-flashcards.ts).
--   Vocab words are user-entered, externally translated (MyMemory API), and
--   carry a pedagogical "user_definition" field that is the entire point of
--   the surface. Coupling them via a `kind` column would:
--     - bloat class_flashcards with vocab-only columns (translation, langs,
--       user_definition) that are NULL on 90%+ of rows
--     - mix the SR review queues (class flashcards drill notes; vocab drills
--       a language), making the "due cards" query branch on `kind` everywhere
--     - tie the vocab schema to any future change in class_flashcards
--   The SR math is identical (SM-2-ish) and lives in pure JS in
--   lib/class-flashcards.ts — vocab can `import { applyRating, SR_DEFAULT_EASE }`
--   from there and reuse it without sharing the table.
--
-- WHAT THIS DOES:
--   1. Creates `vocab_words` — one row per (user, source_word, source_lang,
--      target_lang). RLS owner-only; service role bypasses for server writes.
--   2. Creates `vocab_streaks` — per (user_id, source_lang, target_lang)
--      streak counter. NOT on profiles because profiles.streak is the global
--      daily-activity streak; vocab streaks are per-language-pair (a user
--      learning Spanish + Japanese has two independent counters).
--   3. Column-level UPDATE revokes on the vocab_streaks counter columns
--      (same pattern as fangs_cashable in 20260603013600_dual_ledger_fangs.sql)
--      so the user's JWT cannot mutate the streak directly — only the
--      `advance_vocab_streak` RPC (server-only, service_role) can write.
--
-- DOWNSTREAM SCHEMA CONTRACT (for dev-backend + dev-frontend in this wave):
--   vocab_words:
--     id              uuid primary key default gen_random_uuid()
--     user_id         uuid not null references profiles(id) on delete cascade
--     word            text not null            -- source-language word entered
--     translation     text not null            -- MyMemory API translation
--     source_lang     text not null            -- ISO 639-1, e.g. 'en'
--     target_lang     text not null            -- ISO 639-1, e.g. 'es'
--     user_definition text                     -- user's own def in target lang
--     ease_factor     real not null default 2.5
--     review_count    int  not null default 0
--     correct_count   int  not null default 0
--     last_reviewed_at timestamptz
--     next_review_at  timestamptz not null default now()
--     created_at      timestamptz not null default now()
--     updated_at      timestamptz not null default now()
--     UNIQUE (user_id, source_lang, target_lang, lower(word))
--
--   vocab_streaks:
--     user_id          uuid not null references profiles(id) on delete cascade
--     source_lang      text not null
--     target_lang      text not null
--     streak_count     int  not null default 0
--     streak_last_day  date
--     max_streak       int  not null default 0
--     updated_at       timestamptz not null default now()
--     PRIMARY KEY (user_id, source_lang, target_lang)
--
-- STREAK ADVANCEMENT RULE (server-side; not in this migration):
--   On every `INSERT` into vocab_words the API route should call
--   `advance_vocab_streak(user_id, source_lang, target_lang)`. The RPC counts
--   today's NEW vocab_words for that pair; if count crosses 5, it advances
--   the streak following the same calendar-day-with-grace rules as the
--   global streak (yesterday→today increments; >1 day gap resets to 1).
--   That RPC ships in a follow-up dev-backend migration in this wave.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

-- ---------------------------------------------------------------------------
-- 1. vocab_words
-- ---------------------------------------------------------------------------

create table if not exists vocab_words (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  word             text not null,
  translation      text not null,
  source_lang      text not null,
  target_lang      text not null,
  user_definition  text,
  ease_factor      real not null default 2.5,
  review_count     int  not null default 0,
  correct_count    int  not null default 0,
  last_reviewed_at timestamptz,
  next_review_at   timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Sanity constraints
alter table vocab_words
  add constraint vocab_words_word_len       check (length(word) between 1 and 120) not valid;
alter table vocab_words
  add constraint vocab_words_translation_len check (length(translation) between 1 and 400) not valid;
alter table vocab_words
  add constraint vocab_words_source_lang_iso check (source_lang ~ '^[a-z]{2}$') not valid;
alter table vocab_words
  add constraint vocab_words_target_lang_iso check (target_lang ~ '^[a-z]{2}$') not valid;
alter table vocab_words
  add constraint vocab_words_user_def_len    check (user_definition is null or length(user_definition) <= 1000) not valid;
alter table vocab_words
  add constraint vocab_words_ease_range      check (ease_factor between 1.30 and 5.00) not valid;
alter table vocab_words
  add constraint vocab_words_counts_nonneg   check (review_count >= 0 and correct_count >= 0 and correct_count <= review_count) not valid;

alter table vocab_words validate constraint vocab_words_word_len;
alter table vocab_words validate constraint vocab_words_translation_len;
alter table vocab_words validate constraint vocab_words_source_lang_iso;
alter table vocab_words validate constraint vocab_words_target_lang_iso;
alter table vocab_words validate constraint vocab_words_user_def_len;
alter table vocab_words validate constraint vocab_words_ease_range;
alter table vocab_words validate constraint vocab_words_counts_nonneg;

-- Idempotent uniqueness: a user can't add the same word for the same
-- language pair twice. lower() so "Hola"/"hola" collide. New table → safe
-- to use a unique index (no existing dupes to resolve).
create unique index if not exists vocab_words_user_pair_word_unique
  on vocab_words (user_id, source_lang, target_lang, lower(word));

-- Indexes for the three primary query patterns:
--   a) daily review queue:       WHERE user_id=? ORDER BY next_review_at
--   b) recently added list:      WHERE user_id=? ORDER BY created_at DESC
--   c) per-language-pair drill:  WHERE user_id=? AND source_lang=? AND target_lang=?
create index if not exists vocab_words_user_next_review_idx
  on vocab_words (user_id, next_review_at);
create index if not exists vocab_words_user_created_idx
  on vocab_words (user_id, created_at desc);
create index if not exists vocab_words_user_langs_idx
  on vocab_words (user_id, source_lang, target_lang);

-- updated_at auto-touch on UPDATE
create or replace function vocab_words_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vocab_words_touch_updated_at on vocab_words;
create trigger vocab_words_touch_updated_at
  before update on vocab_words
  for each row execute function vocab_words_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. vocab_words RLS — owner only
-- ---------------------------------------------------------------------------

alter table vocab_words enable row level security;

drop policy if exists vocab_words_select on vocab_words;
create policy vocab_words_select on vocab_words
  for select using (auth.uid() = user_id);

drop policy if exists vocab_words_insert on vocab_words;
create policy vocab_words_insert on vocab_words
  for insert with check (auth.uid() = user_id);

drop policy if exists vocab_words_update on vocab_words;
create policy vocab_words_update on vocab_words
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists vocab_words_delete on vocab_words;
create policy vocab_words_delete on vocab_words
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. vocab_streaks — per-language-pair streak counters
-- ---------------------------------------------------------------------------
--
-- Composite-PK design (no surrogate id). Lookups are always by the full
-- triple; no need for a separate uuid.

create table if not exists vocab_streaks (
  user_id          uuid not null references profiles(id) on delete cascade,
  source_lang      text not null,
  target_lang      text not null,
  streak_count     int  not null default 0,
  streak_last_day  date,
  max_streak       int  not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (user_id, source_lang, target_lang)
);

alter table vocab_streaks
  add constraint vocab_streaks_source_iso check (source_lang ~ '^[a-z]{2}$') not valid;
alter table vocab_streaks
  add constraint vocab_streaks_target_iso check (target_lang ~ '^[a-z]{2}$') not valid;
alter table vocab_streaks
  add constraint vocab_streaks_counts_nonneg
    check (streak_count >= 0 and max_streak >= 0 and max_streak >= streak_count) not valid;

alter table vocab_streaks validate constraint vocab_streaks_source_iso;
alter table vocab_streaks validate constraint vocab_streaks_target_iso;
alter table vocab_streaks validate constraint vocab_streaks_counts_nonneg;

-- Single supporting index: by user, for "all my streaks" dashboard query.
-- The PK already covers single-pair lookups.
create index if not exists vocab_streaks_user_idx
  on vocab_streaks (user_id);

-- ---------------------------------------------------------------------------
-- 4. vocab_streaks RLS + column-level revokes
-- ---------------------------------------------------------------------------
--
-- READ: owner only (users see their own streaks on the /learn dashboard).
-- WRITE: NO user-side writes. Same pattern as fangs_cashable — RLS subquery
-- checks can silently pass on self-mutation due to RLS re-entry; the only
-- ironclad lock is a column-level GRANT revoke. The streak-advance RPC
-- (shipped by dev-backend in a follow-up migration) runs as SECURITY DEFINER
-- with service_role permissions and is the sole writer.

alter table vocab_streaks enable row level security;

drop policy if exists vocab_streaks_select on vocab_streaks;
create policy vocab_streaks_select on vocab_streaks
  for select using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies on purpose — service_role bypasses RLS,
-- and we don't want PostgREST to expose any write path to the user JWT.

revoke insert, update, delete on vocab_streaks from authenticated;
revoke insert, update, delete on vocab_streaks from anon;

-- Column-level UPDATE revoke on the counter columns specifically (defense
-- in depth in case a future migration accidentally re-grants table-level
-- UPDATE). Mirrors the fangs_cashable / lifetime_fangs_spent pattern.
revoke update (
  streak_count,
  streak_last_day,
  max_streak
) on vocab_streaks from authenticated;
revoke update (
  streak_count,
  streak_last_day,
  max_streak
) on vocab_streaks from anon;

-- ---------------------------------------------------------------------------
-- Notes for downstream agents
-- ---------------------------------------------------------------------------
--
-- dev-backend wave will add:
--   - advance_vocab_streak(p_user_id uuid, p_source_lang text, p_target_lang text)
--     RPC (SECURITY DEFINER) called fire-and-forget from the vocab_words
--     INSERT route. It counts today's inserts for that pair; if today's
--     count just crossed 5, it advances or resets the streak using the
--     standard yesterday→today / >1-day-gap rules.
--
-- DEFERRED (NOT in this migration — flag for coordination):
--   - Data retention. Vocab is user-generated language data; we don't have
--     a deletion SLA wired up. Currently relies on `on delete cascade` from
--     profiles, which fires only on full account deletion. If we ship a
--     per-feature "wipe my vocab" button (likely in V2), we'll need
--     either a soft-delete column or a documented hard-delete route.
--     Not a launch blocker; surfacing for business-legal-compliance to
--     confirm scope under our current privacy policy before V2.
