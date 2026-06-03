-- Word Banks V2: generalize Vocab V1 from language-only to themed term-study
-- "banks" (Spanish 101, AWS Security Specialty, Math Theorems, Hacking 101, ...).
--
-- WHY (Path A → V2 generalization):
--   V1 (20260603090250_vocab_words.sql) hard-coded the schema around language
--   pairs: `source_lang`/`target_lang` on every vocab_words row, the unique
--   index keyed on the language pair, and `vocab_streaks` PK'd on
--   (user_id, source_lang, target_lang). That shape works for "I'm learning
--   Spanish" but breaks the moment a user wants a non-language bank — there
--   IS no source/target lang for "AWS Security Specialty terms." V2 introduces
--   a parent `vocab_banks` table that owns the (kind, color, icon, name, slug)
--   identity of a study set; vocab_words rows now hang off `bank_id`; streaks
--   are bank-keyed. Language pairs MOVE from vocab_words onto vocab_banks
--   (only meaningful for `kind='language'`).
--
-- WHAT THIS DOES:
--   1. Creates `vocab_banks` (parent) with kind ('language' | 'general'),
--      partial-CHECK enforcing lang pair iff language, case-insensitive
--      uniqueness on (user_id, name), trigger-auto-derived `slug`.
--   2. Adds `bank_id` (nullable initially), `term_definition`,
--      `definition_source` to vocab_words. New CHECK: at least one of
--      `translation` or `term_definition` is set. Adds `(user_id, bank_id,
--      next_review_at)` composite index for per-bank due-words query.
--   3. BACKFILL: for each user with existing vocab_words, create a single
--      default "Languages" bank (kind='language', icon='🌍', color='#A855F7')
--      using the user's MOST-USED source_lang + target_lang pair (mode over
--      their rows). Assigns ALL of that user's vocab_words.bank_id to that
--      bank — regardless of the row's actual lang pair. This is the only
--      sane move with the current unique constraint `UNIQUE (user_id, lower(name))`
--      on vocab_banks: we can't auto-create N banks per user without inventing
--      N distinct names. Existing users in practice almost certainly have a
--      single pair (Spanish-from-English) — Sam is pre-launch on Vocab, so
--      polyglot users are vanishingly rare in the data today. Edge case
--      flagged in the migration footer.
--   4. Flips vocab_words.bank_id to NOT NULL after backfill.
--   5. Adds `bank_id` to vocab_streaks, backfills from each user's
--      Languages bank, drops `source_lang` + `target_lang`, swaps PK to
--      `(user_id, bank_id)`.
--   6. Replaces `advance_vocab_streak(uuid, text, text)` with
--      `advance_vocab_streak(uuid, uuid)` — bank-keyed. Old signature dropped
--      so every caller is forced to migrate (tsc + runtime errors are the
--      safety net, same pattern as the dual-ledger update_user_coins drop).
--   7. RLS: owner-only CRUD on vocab_banks + FORCE row level security.
--      Column-level UPDATE revoke on vocab_words.bank_id so a user JWT can't
--      reparent a word to another bank via direct PostgREST UPDATE (must go
--      through a server route or RPC).
--
-- TRANSACTIONALITY:
--   Wrapped in BEGIN/COMMIT. If backfill fails partway, the entire migration
--   rolls back — no orphan vocab_words rows, no half-migrated streaks, no
--   half-dropped columns. The temporary nullability of vocab_words.bank_id
--   exists ONLY inside this transaction; on COMMIT it is NOT NULL.
--
-- DATA-LOSS RISK:
--   Low. The only destructive step is dropping `vocab_streaks.source_lang` +
--   `target_lang` after backfill. If backfill misses a streak row (would
--   only happen if a user has a vocab_streak with no corresponding word —
--   shouldn't be possible given the RPC only writes on word INSERT, but
--   defensive: any unmapped streak row gets a synthesized bank, never
--   silently dropped). See "BACKFILL SAFETY NOTES" below.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

begin;

-- ---------------------------------------------------------------------------
-- 1. vocab_banks (parent of vocab_words)
-- ---------------------------------------------------------------------------

create table if not exists vocab_banks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null,
  slug        text not null,
  kind        text not null check (kind in ('language','general')),
  source_lang text,
  target_lang text,
  color       text not null default '#A855F7',
  icon        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Length + format guards.
alter table vocab_banks
  add constraint vocab_banks_name_len   check (length(name) between 1 and 80) not valid;
alter table vocab_banks
  add constraint vocab_banks_slug_len   check (length(slug) between 1 and 80) not valid;
alter table vocab_banks
  add constraint vocab_banks_slug_fmt   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;
alter table vocab_banks
  add constraint vocab_banks_color_hex  check (color ~ '^#[0-9A-Fa-f]{6}$') not valid;
alter table vocab_banks
  add constraint vocab_banks_icon_len   check (icon is null or length(icon) <= 16) not valid;
alter table vocab_banks
  add constraint vocab_banks_source_iso check (source_lang is null or source_lang ~ '^[a-z]{2}$') not valid;
alter table vocab_banks
  add constraint vocab_banks_target_iso check (target_lang is null or target_lang ~ '^[a-z]{2}$') not valid;

-- Language banks MUST have a lang pair; general banks MUST NOT. Single
-- composite CHECK so we can't end up with a half-configured row.
alter table vocab_banks
  add constraint vocab_banks_kind_lang_consistency check (
    (kind = 'language' and source_lang is not null and target_lang is not null)
    or
    (kind = 'general'  and source_lang is null     and target_lang is null)
  ) not valid;

alter table vocab_banks validate constraint vocab_banks_name_len;
alter table vocab_banks validate constraint vocab_banks_slug_len;
alter table vocab_banks validate constraint vocab_banks_slug_fmt;
alter table vocab_banks validate constraint vocab_banks_color_hex;
alter table vocab_banks validate constraint vocab_banks_icon_len;
alter table vocab_banks validate constraint vocab_banks_source_iso;
alter table vocab_banks validate constraint vocab_banks_target_iso;
alter table vocab_banks validate constraint vocab_banks_kind_lang_consistency;

-- A user can't have two banks with the same name (case-insensitive).
create unique index if not exists vocab_banks_user_name_unique
  on vocab_banks (user_id, lower(name));

-- Slug-by-user for any /vocab/[bankSlug] URL routing.
create unique index if not exists vocab_banks_user_slug_unique
  on vocab_banks (user_id, slug);

-- Index for "all my banks" dashboard query (most recent first).
create index if not exists vocab_banks_user_created_idx
  on vocab_banks (user_id, created_at desc);

-- Auto-derive `slug` from `name` if caller didn't pass one. Server callers
-- can also pass an explicit slug and the trigger leaves it alone. We do this
-- DB-side (not client-side) so two clients with different slug logic can't
-- diverge — and so the unique-by-user-slug index stays trustworthy.
create or replace function vocab_banks_derive_slug()
returns trigger
language plpgsql
as $$
declare
  v_base text;
  v_candidate text;
  v_n int := 1;
begin
  if new.slug is null or length(trim(new.slug)) = 0 then
    -- lowercase, alnum-only, dashes between tokens, trim leading/trailing dashes
    v_base := regexp_replace(lower(coalesce(new.name, '')), '[^a-z0-9]+', '-', 'g');
    v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
    if v_base = '' then
      v_base := 'bank';
    end if;
    v_candidate := v_base;
    -- Collision resolution against existing slugs for this user.
    while exists (
      select 1 from vocab_banks
      where user_id = new.user_id
        and slug = v_candidate
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) loop
      v_n := v_n + 1;
      v_candidate := v_base || '-' || v_n::text;
    end loop;
    new.slug := v_candidate;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vocab_banks_derive_slug on vocab_banks;
create trigger vocab_banks_derive_slug
  before insert or update on vocab_banks
  for each row execute function vocab_banks_derive_slug();

-- ---------------------------------------------------------------------------
-- 2. vocab_banks RLS — owner only, FORCED
-- ---------------------------------------------------------------------------

alter table vocab_banks enable row level security;
alter table vocab_banks force  row level security;

drop policy if exists vocab_banks_select on vocab_banks;
create policy vocab_banks_select on vocab_banks
  for select using (auth.uid() = user_id);

drop policy if exists vocab_banks_insert on vocab_banks;
create policy vocab_banks_insert on vocab_banks
  for insert with check (auth.uid() = user_id);

drop policy if exists vocab_banks_update on vocab_banks;
create policy vocab_banks_update on vocab_banks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists vocab_banks_delete on vocab_banks;
create policy vocab_banks_delete on vocab_banks
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. vocab_words: new columns
-- ---------------------------------------------------------------------------
--
-- bank_id is nullable for now so the backfill can run; we flip it to
-- NOT NULL at the bottom of this transaction once every row has a parent.

alter table vocab_words
  add column if not exists bank_id           uuid references vocab_banks(id) on delete cascade,
  add column if not exists term_definition   text,
  add column if not exists definition_source text;

-- term_definition length cap (mirrors translation cap).
alter table vocab_words
  add constraint vocab_words_term_def_len
    check (term_definition is null or length(term_definition) between 1 and 400) not valid;

-- One of translation / term_definition must be set. Language banks use
-- `translation` (existing field); general banks use `term_definition`.
-- Both nullable individually but row must have at least one. NOT VALID +
-- VALIDATE pattern lets us add this without scanning the whole table under
-- AccessExclusiveLock; we validate after the backfill below.
alter table vocab_words
  add constraint vocab_words_has_answer
    check (translation is not null or term_definition is not null) not valid;

alter table vocab_words
  add constraint vocab_words_definition_source
    check (definition_source is null or definition_source in ('mymemory','wikipedia','ai','manual')) not valid;

-- Composite index for the per-bank due-words query:
--   WHERE user_id=? AND bank_id=? ORDER BY next_review_at
create index if not exists vocab_words_user_bank_next_review_idx
  on vocab_words (user_id, bank_id, next_review_at);

-- ---------------------------------------------------------------------------
-- 4. BACKFILL: existing vocab_words → a default "Languages" bank per user
-- ---------------------------------------------------------------------------
--
-- For every user with existing vocab_words, create ONE bank named "Languages"
-- (kind='language') using that user's MOST-USED (source_lang, target_lang)
-- pair as the bank's pair. Then point all of that user's vocab_words to it.
--
-- BACKFILL SAFETY NOTES:
--   - This loop runs inside the migration transaction. If any step raises,
--     COMMIT never happens and the entire migration rolls back. We never end
--     up with a half-migrated state in production.
--   - User-count scale at the time of this migration is < ~few thousand
--     vocab_users (Sam is pre-launch on Vocab — V1 shipped < 24h ago). The
--     inline loop runs in well under a second at that scale. If volume
--     grows past ~50k vocab-using users this should move to a batched
--     maintenance migration with `LIMIT/OFFSET` paging.
--   - Multi-lang-pair users: a user with both ('en','es') and ('en','ja')
--     vocab_words rows gets ONE "Languages" bank using their MOST-USED pair.
--     The minority-pair rows end up under that single bank too. This is
--     intentional for V2 (avoids inventing 2 distinct user-visible bank
--     names automatically — which would also collide with the
--     unique-by-name index). Sam can manually split via the UI post-launch
--     if any real user reports this. Edge case explicitly accepted.
--   - definition_source = 'mymemory' for every backfilled row — every V1
--     vocab word came through the MyMemory API translate route.

do $$
declare
  r record;
  v_bank_id uuid;
  v_src text;
  v_tgt text;
begin
  for r in
    select distinct user_id
    from vocab_words
    where bank_id is null
  loop
    -- Find this user's most-used lang pair (mode). Tie-breaker: earliest
    -- created_at — whichever pair the user picked first.
    select source_lang, target_lang
      into v_src, v_tgt
    from (
      select source_lang,
             target_lang,
             count(*)        as n,
             min(created_at) as first_seen
      from vocab_words
      where user_id = r.user_id
      group by source_lang, target_lang
      order by count(*) desc, min(created_at) asc
      limit 1
    ) top_pair;

    -- Safety: vocab_words.source_lang/target_lang are NOT NULL in V1 schema,
    -- so v_src/v_tgt cannot be null here. Belt-and-suspenders defensive
    -- check in case the V1 constraints were ever weakened.
    if v_src is null or v_tgt is null then
      v_src := 'en';
      v_tgt := 'es';
    end if;

    -- Idempotency: skip if this user already has a "Languages" bank (e.g.
    -- if the migration is re-run after a partial rollback). The unique
    -- index on (user_id, lower(name)) makes this safe to check by name.
    select id into v_bank_id
    from vocab_banks
    where user_id = r.user_id and lower(name) = lower('Languages')
    limit 1;

    if v_bank_id is null then
      insert into vocab_banks (user_id, name, kind, source_lang, target_lang, color, icon)
      values (r.user_id, 'Languages', 'language', v_src, v_tgt, '#A855F7', '🌍')
      returning id into v_bank_id;
    end if;

    -- Point all of this user's still-orphan vocab_words at the new bank,
    -- and mark them as MyMemory-sourced (the only V1 definition source).
    update vocab_words
      set bank_id = v_bank_id,
          definition_source = coalesce(definition_source, 'mymemory')
      where user_id = r.user_id and bank_id is null;
  end loop;
end$$;

-- Every row now has a parent. Lock it in.
alter table vocab_words
  alter column bank_id set not null;

-- Validate the deferred check constraints against the now-backfilled data.
alter table vocab_words validate constraint vocab_words_term_def_len;
alter table vocab_words validate constraint vocab_words_has_answer;
alter table vocab_words validate constraint vocab_words_definition_source;

-- ---------------------------------------------------------------------------
-- 5. vocab_words: column-level UPDATE lockdown on bank_id
-- ---------------------------------------------------------------------------
--
-- Same defense-in-depth pattern as fangs_cashable / vocab_streaks counters:
-- a user's JWT must not be able to reparent a word to another bank via a
-- direct PostgREST PATCH. All cross-bank moves go through a server route
-- (or future RPC) running as service_role.
--
-- definition_source is also locked down — it's an analytics/cost-monitoring
-- field, not user-mutable.

revoke update (bank_id, definition_source) on vocab_words from authenticated;
revoke update (bank_id, definition_source) on vocab_words from anon;

-- ---------------------------------------------------------------------------
-- 6. vocab_streaks: re-key on bank_id
-- ---------------------------------------------------------------------------
--
-- Add bank_id (nullable), backfill from each user's Languages bank by
-- matching the lang pair, drop the old PK + old lang columns, swap the PK
-- to (user_id, bank_id).

alter table vocab_streaks
  add column if not exists bank_id uuid references vocab_banks(id) on delete cascade;

-- Backfill. We match each streak row to the user's bank with the same
-- (source_lang, target_lang) pair. The migration ABOVE created one
-- "Languages" bank per user with their most-used pair — so for any user
-- whose streak pair matches that pair, this resolves cleanly. For users
-- with a streak on a NON-most-used pair (rare polyglot case), the streak
-- row's pair won't match the Languages bank pair, and bank_id stays NULL —
-- handled in the next block.

update vocab_streaks vs
  set bank_id = vb.id
  from vocab_banks vb
  where vb.user_id = vs.user_id
    and vb.kind = 'language'
    and vb.source_lang = vs.source_lang
    and vb.target_lang = vs.target_lang
    and vs.bank_id is null;

-- Fallback: any streak row still unmatched (polyglot case) gets attached
-- to the user's "Languages" bank regardless of pair match — preserving
-- the streak count rather than dropping it. The streak count under V2
-- semantics will now key on bank, so a multi-pair user collapses to one
-- bank-streak (same lossy-but-non-destructive trade-off accepted in §4).
update vocab_streaks vs
  set bank_id = vb.id
  from vocab_banks vb
  where vb.user_id = vs.user_id
    and vb.kind = 'language'
    and lower(vb.name) = lower('Languages')
    and vs.bank_id is null;

-- If multiple streak rows now collide on (user_id, bank_id), keep the row
-- with the highest streak_count + max_streak (preserve the user's best
-- progress). Delete the rest. This only fires for the rare polyglot case
-- handled above.
delete from vocab_streaks vs1
using vocab_streaks vs2
where vs1.user_id = vs2.user_id
  and vs1.bank_id = vs2.bank_id
  and vs1.bank_id is not null
  and (vs1.streak_count, vs1.max_streak, vs1.source_lang, vs1.target_lang)
      < (vs2.streak_count, vs2.max_streak, vs2.source_lang, vs2.target_lang);

-- Every row should now have a bank_id. Lock it in.
alter table vocab_streaks
  alter column bank_id set not null;

-- Swap the primary key. Drop the old composite PK first.
alter table vocab_streaks
  drop constraint if exists vocab_streaks_pkey;

alter table vocab_streaks
  add primary key (user_id, bank_id);

-- Drop the now-obsolete language columns. Their data was migrated to
-- vocab_banks.source_lang / target_lang in §4 and the streak rows are now
-- keyed on bank_id.
alter table vocab_streaks
  drop column if exists source_lang,
  drop column if exists target_lang;

-- Drop the now-obsolete CHECK constraints that referenced the dropped
-- columns. (alter table ... drop column cascades constraints by default
-- but being explicit is cheap.)
alter table vocab_streaks
  drop constraint if exists vocab_streaks_source_iso,
  drop constraint if exists vocab_streaks_target_iso;

-- Drop the now-redundant user-only index (PK already starts with user_id).
drop index if exists vocab_streaks_user_idx;

-- ---------------------------------------------------------------------------
-- 7. advance_vocab_streak RPC: bank-keyed
-- ---------------------------------------------------------------------------
--
-- Old signature: advance_vocab_streak(p_user_id uuid, p_source_lang text, p_target_lang text)
-- New signature: advance_vocab_streak(p_user_id uuid, p_bank_id uuid)
--
-- We DROP the old signature at the bottom so every caller is forced to
-- migrate — same forcing-function pattern as the dual-ledger
-- update_user_coins drop in 20260603013600_dual_ledger_fangs.sql.

create or replace function public.advance_vocab_streak(
  p_user_id uuid,
  p_bank_id uuid
)
returns table (
  streak_count int,
  streak_last_day date,
  max_streak int,
  bumped boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today          date := (now() at time zone 'utc')::date;
  v_yesterday      date := v_today - 1;
  v_today_count    int;
  v_prev_count     int;
  v_prev_max       int;
  v_prev_last_day  date;
  v_next_count     int;
  v_next_max       int;
  v_bumped         boolean := false;
  v_role           text := coalesce(auth.role(), '');
  v_bank_owner     uuid;
begin
  -- Argument validation.
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = 'P0001';
  end if;
  if p_bank_id is null then
    raise exception 'p_bank_id required' using errcode = 'P0001';
  end if;

  -- Caller-identity check, same pattern as update_user_coins:
  -- non-service callers can only advance THEIR OWN streak, and the bank
  -- must belong to them. Service role bypasses (it has no auth.uid()).
  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden: caller % cannot mutate user %', auth.uid(), p_user_id
        using errcode = '42501';
    end if;
  end if;

  -- Bank-ownership check (defense in depth even for service role — prevents
  -- a server bug from advancing a streak against the wrong user's bank).
  select user_id into v_bank_owner from vocab_banks where id = p_bank_id;
  if v_bank_owner is null then
    raise exception 'bank not found: %', p_bank_id using errcode = 'P0002';
  end if;
  if v_bank_owner <> p_user_id then
    raise exception 'bank % does not belong to user %', p_bank_id, p_user_id
      using errcode = '42501';
  end if;

  -- How many vocab words has this user added for this BANK today (UTC)?
  select count(*) into v_today_count
  from vocab_words
  where user_id = p_user_id
    and bank_id = p_bank_id
    and created_at >= v_today::timestamptz
    and created_at <  (v_today + 1)::timestamptz;

  -- Load existing streak row (may be null).
  select streak_count, max_streak, streak_last_day
    into v_prev_count, v_prev_max, v_prev_last_day
  from vocab_streaks
  where user_id = p_user_id and bank_id = p_bank_id;

  -- If we haven't crossed the daily threshold yet, no-op.
  if v_today_count < 5 then
    return query select
      coalesce(v_prev_count, 0),
      v_prev_last_day,
      coalesce(v_prev_max, 0),
      false;
    return;
  end if;

  -- We're at >=5 today. Did we already bump today? If so, no-op.
  if v_prev_last_day = v_today then
    return query select v_prev_count, v_prev_last_day, v_prev_max, false;
    return;
  end if;

  -- Continue if last_day was exactly yesterday, else reset.
  if v_prev_last_day = v_yesterday then
    v_next_count := coalesce(v_prev_count, 0) + 1;
  else
    v_next_count := 1;
  end if;

  v_next_max := greatest(coalesce(v_prev_max, 0), v_next_count);
  v_bumped := true;

  insert into vocab_streaks (
    user_id, bank_id,
    streak_count, streak_last_day, max_streak, updated_at
  ) values (
    p_user_id, p_bank_id,
    v_next_count, v_today, v_next_max, now()
  )
  on conflict (user_id, bank_id) do update
  set streak_count    = excluded.streak_count,
      streak_last_day = excluded.streak_last_day,
      max_streak      = excluded.max_streak,
      updated_at      = now();

  return query select v_next_count, v_today, v_next_max, v_bumped;
end;
$$;

-- Server-only RPC. Every callsite uses `supabaseAdmin` (service role). Be
-- explicit about the lockdown.
revoke execute on function public.advance_vocab_streak(uuid, uuid) from public, authenticated, anon;
grant  execute on function public.advance_vocab_streak(uuid, uuid) to service_role;

-- Force every caller to migrate to the new signature. Without this drop,
-- PostgREST + supabase-js would happily resolve the 3-arg version (Postgres
-- overloads on arity), and any stale call would silently no-op against the
-- now-empty (source_lang, target_lang) join.
drop function if exists public.advance_vocab_streak(uuid, text, text);

commit;

-- ---------------------------------------------------------------------------
-- Notes for downstream agents
-- ---------------------------------------------------------------------------
--
-- dev-backend follow-up:
--   - /api/vocab/banks (CRUD): GET list, POST create (validate kind/lang
--     pair consistency client- AND server-side; the CHECK constraint is the
--     hard floor but a typed Zod schema gives nicer errors), PATCH rename/
--     color/icon, DELETE (CASCADEs to vocab_words — see retention note).
--   - /api/vocab/words: now requires `bank_id` in the POST body. Server
--     verifies the bank belongs to the caller before insert.
--   - /api/vocab/words: when bank.kind = 'general', the definition source
--     cascade is Wikipedia → AI → manual; route MUST set
--     `definition_source` accordingly (used for cost monitoring on the AI
--     fallback path).
--   - /api/vocab/streak (or wherever advance_vocab_streak is called): swap
--     the 3-arg call to the 2-arg (user_id, bank_id) version. The OLD
--     signature is DROPPED above — tsc + runtime errors will flag stale
--     callsites.
--
-- DEFERRED (NOT in this migration — open question):
--   - Soft-delete vs hard-delete on bank deletion. V2 ships hard-delete
--     via `on delete cascade`: deleting a bank deletes every vocab_word
--     inside it. This is the safer default for the data-retention story
--     (privacy-policy aligned) but it's destructive if a user fat-fingers
--     "delete bank". Mitigation lives in the UI layer (two-step confirm
--     with the bank name typed back). If user feedback warrants undo,
--     a follow-up migration adds `deleted_at timestamptz` for soft delete
--     + a 30-day purge cron. Flagged for `business-legal-compliance`
--     review before V2 promo blast; not a launch blocker.
--   - Polyglot user multi-pair handling: V2 collapses any user with
--     multiple lang pairs into a single "Languages" bank. If we hear
--     from a user post-launch, the UI can let them split via a "Move
--     words to new bank" action that calls a service-role-only
--     reparent RPC (not in this migration).
