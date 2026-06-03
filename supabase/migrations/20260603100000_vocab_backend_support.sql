-- Vocab V1 backend-side support: translation cache + streak-advance RPC.
--
-- Companion to 20260603090250_vocab_words.sql (dev-database). That migration
-- explicitly defers the `advance_vocab_streak` RPC to dev-backend — this is
-- where it lands.
--
-- WHAT THIS DOES:
--   1. Creates `vocab_translations_cache` — keyed on (lower(word), source_lang,
--      target_lang). Owned by /api/vocab/translate. Service-role-only.
--   2. Creates `advance_vocab_streak(p_user_id, p_source_lang, p_target_lang)`
--      RPC — called from /api/vocab/words POST after a successful insert.
--      Counts today's inserts for the pair; if today's count just crossed 5,
--      advances or resets the streak following yesterday→today / gap rules.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

-- ---------------------------------------------------------------------------
-- 1. vocab_translations_cache
-- ---------------------------------------------------------------------------
--
-- Why a table (not in-memory LRU):
--   Vercel serverless instances are ephemeral and regional; an in-memory cache
--   would have ~0% hit rate across cold starts and multi-region fan-out, so
--   the MyMemory free-tier quota (50k chars/day with the de=<email> bump)
--   would still get burned by repeated lookups of the same word. A tiny
--   Postgres read on the composite PK is ~1ms and survives restarts.

create table if not exists vocab_translations_cache (
  word_lower    text not null,
  source_lang   text not null,
  target_lang   text not null,
  translation   text not null,
  hits          integer not null default 1,
  created_at    timestamptz not null default now(),
  last_hit_at   timestamptz not null default now(),
  primary key (word_lower, source_lang, target_lang)
);

alter table vocab_translations_cache
  add constraint vocab_cache_source_iso check (source_lang ~ '^[a-z]{2}$') not valid;
alter table vocab_translations_cache
  add constraint vocab_cache_target_iso check (target_lang ~ '^[a-z]{2}$') not valid;
alter table vocab_translations_cache
  add constraint vocab_cache_word_len   check (length(word_lower) between 1 and 120) not valid;

alter table vocab_translations_cache validate constraint vocab_cache_source_iso;
alter table vocab_translations_cache validate constraint vocab_cache_target_iso;
alter table vocab_translations_cache validate constraint vocab_cache_word_len;

create index if not exists vocab_cache_last_hit_idx
  on vocab_translations_cache (last_hit_at desc);

-- Service-role-only. Clients never touch this table directly; the
-- /api/vocab/translate route reads/writes via supabaseAdmin.
alter table vocab_translations_cache enable row level security;

revoke select, insert, update, delete on vocab_translations_cache from authenticated;
revoke select, insert, update, delete on vocab_translations_cache from anon;

-- ---------------------------------------------------------------------------
-- 2. advance_vocab_streak RPC
-- ---------------------------------------------------------------------------
--
-- Called fire-and-forget from /api/vocab/words POST after a successful row
-- insert. Counts TODAY's new vocab_words rows for (user, source, target);
-- if the count just crossed 5 AND we haven't already advanced today, the
-- streak ticks. Rules mirror the global daily streak:
--   - streak_last_day == today: no-op (already advanced today)
--   - streak_last_day == yesterday: streak_count += 1
--   - else: streak_count = 1 (reset)
-- max_streak tracks the all-time high.
--
-- security definer so the RPC can write through the column-level UPDATE
-- revoke on vocab_streaks counter columns; locked search_path prevents
-- search-path-poisoning.

create or replace function public.advance_vocab_streak(
  p_user_id uuid,
  p_source_lang text,
  p_target_lang text
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
begin
  -- Argument validation.
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = 'P0001';
  end if;
  if p_source_lang !~ '^[a-z]{2}$' or p_target_lang !~ '^[a-z]{2}$' then
    raise exception 'invalid lang code' using errcode = 'P0001';
  end if;

  -- How many vocab words has this user added for this pair today (UTC)?
  select count(*) into v_today_count
  from vocab_words
  where user_id = p_user_id
    and source_lang = p_source_lang
    and target_lang = p_target_lang
    and created_at >= v_today::timestamptz
    and created_at <  (v_today + 1)::timestamptz;

  -- Load existing streak row (may be null).
  select streak_count, max_streak, streak_last_day
    into v_prev_count, v_prev_max, v_prev_last_day
  from vocab_streaks
  where user_id = p_user_id
    and source_lang = p_source_lang
    and target_lang = p_target_lang;

  -- If we haven't crossed the daily threshold yet, no-op (return current).
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

  -- Compute next count: continue if last_day was exactly yesterday, else reset.
  if v_prev_last_day = v_yesterday then
    v_next_count := coalesce(v_prev_count, 0) + 1;
  else
    v_next_count := 1;
  end if;

  v_next_max := greatest(coalesce(v_prev_max, 0), v_next_count);
  v_bumped := true;

  insert into vocab_streaks (
    user_id, source_lang, target_lang,
    streak_count, streak_last_day, max_streak, updated_at
  ) values (
    p_user_id, p_source_lang, p_target_lang,
    v_next_count, v_today, v_next_max, now()
  )
  on conflict (user_id, source_lang, target_lang) do update
  set streak_count    = excluded.streak_count,
      streak_last_day = excluded.streak_last_day,
      max_streak      = excluded.max_streak,
      updated_at      = now();

  return query select v_next_count, v_today, v_next_max, v_bumped;
end;
$$;

grant execute on function public.advance_vocab_streak(uuid, text, text)
  to service_role;
-- NOT granted to authenticated: the user JWT must not be able to forge a
-- streak advance. The /api/vocab/words route calls this via supabaseAdmin.
