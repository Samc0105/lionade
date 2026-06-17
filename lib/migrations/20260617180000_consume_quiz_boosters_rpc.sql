-- ============================================================
-- Migration 20260617180000: consume_quiz_boosters() - transactional, row-locked
-- booster consumption for the server-authoritative quiz-reward derive path.
--
-- RUN MANUALLY by Sam (Supabase SQL editor / MCP apply_migration). UNAPPLIED in
-- prod until then. Fully idempotent; safe to re-run (IF NOT EXISTS / CREATE OR
-- REPLACE throughout).
-- ============================================================
--
-- WHY: app/api/save-quiz-results (deriveReward path) READS active_boosters,
-- derives the reward multiplier from the read, then later consumes the
-- contributing boosters via an atomic owner-scoped conditional decrement. That
-- atomic decrement closes the double-CONSUME race, but NOT the double-DERIVE
-- one: two CONCURRENT DISTINCT attempts (different attempt_ids, e.g. two tabs)
-- can both READ a single-use booster as available and both derive its
-- multiplier before either decrements, so both quizzes get the boosted reward
-- off one booster. The attempt_id replay guard does NOT help - these are two
-- legitimate distinct submissions, not a replay of one.
--
-- FIX: derive-from-the-consume. This function consumes contending boosters
-- under SELECT ... FOR UPDATE SKIP LOCKED inside one transaction, and RETURNS
-- the set it actually consumed. The route derives its multipliers from THAT set
-- (not from a stale pre-read). Two concurrent distinct attempts contending for
-- one single-use booster: one locks+decrements it, the other SKIPs it (gets
-- nothing for that effect), so only one attempt's reward includes the
-- multiplier. The race is closed.
--
-- IDEMPOTENCY: a per-attempt ledger row (quiz_booster_consumption, PK
-- (user_id, attempt_id)) records exactly what was consumed for that attempt. A
-- re-call with the same (user_id, attempt_id) returns the stored set WITHOUT
-- re-consuming - so a network retry / double-submit never double-spends,
-- independent of the route's own 23505 session-insert guard. A concurrent
-- same-attempt caller converges on the one recorded set via INSERT ... ON
-- CONFLICT DO NOTHING + re-SELECT. The key is (user_id, attempt_id) - NOT
-- attempt_id alone - so a (astronomically unlikely) cross-user attempt_id
-- collision can never return another user's consumed set or skip their consume.
--
-- Service-role only (written exclusively by the server route). RLS on + no
-- client policy = deny-all for anon/authenticated, matching the other internal
-- claim tables (user_milestone_awards, reward_claims, game_rewards).

-- ── Per-attempt consumption ledger ─────────────────────────────────────────
create table if not exists quiz_booster_consumption (
  attempt_id  uuid not null,
  user_id     uuid not null references profiles(id) on delete cascade,
  consumed    jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, attempt_id)
);

alter table quiz_booster_consumption enable row level security;
revoke all on quiz_booster_consumption from anon;
revoke all on quiz_booster_consumption from authenticated;
grant all on quiz_booster_consumption to service_role;

-- ── Transactional, row-locked booster consumption ──────────────────────────
-- p_effects is the route's de-duped, priority-ordered list of effects to
-- consume (e.g. {'coin_multiplier','xp_multiplier','score_boost'} or a
-- {'coin_xp_multiplier', ...} when Double Down is active). Returns a jsonb
-- array of the boosters ACTUALLY consumed:
--   [{ "effect": <boost_type>, "value": <boost_value>, "booster_id": <id> }, ...]
-- The live physical columns are boost_type / boost_value (migration 039 index +
-- the activate-booster insert path); this function targets those directly.
create or replace function public.consume_quiz_boosters(
  p_user_id   uuid,
  p_attempt_id uuid,
  p_effects   text[]
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_existing  jsonb;
  v_consumed  jsonb := '[]'::jsonb;
  v_effect    text;
  v_id        uuid;
  v_type      text;
  v_value     numeric;
  v_remaining integer;
begin
  -- Serialize concurrent callers sharing the SAME attempt_id (a retry /
  -- double-submit). A per-attempt advisory xact lock means only one such caller
  -- runs the consume; the others wait, then see the ledger row below and
  -- short-circuit - so the same attempt can never decrement a booster that is
  -- not in its recorded consumed set (no orphan consume). DISTINCT attempts
  -- take different locks and proceed concurrently; their contention is resolved
  -- by FOR UPDATE SKIP LOCKED on the booster rows, not by this lock.
  perform pg_advisory_xact_lock(hashtextextended('consume_quiz_boosters:' || p_user_id::text || ':' || p_attempt_id::text, 0));

  -- IDEMPOTENT short-circuit: this (user, attempt) already consumed - return
  -- that set unchanged, never re-consume. Scoped to user_id so a foreign
  -- attempt_id never returns another user's set.
  select consumed into v_existing
  from quiz_booster_consumption
  where attempt_id = p_attempt_id and user_id = p_user_id;
  if found then
    return v_existing;
  end if;

  -- Consume each requested effect in array order. SELECT ... FOR UPDATE SKIP
  -- LOCKED so a concurrent DISTINCT attempt contending for the SAME single-use
  -- row skips it (gets nothing for that effect) rather than blocking or
  -- double-deriving. LIMIT 1: one booster row per effect, matching the route's
  -- find()-first semantics.
  if p_effects is not null then
    foreach v_effect in array p_effects loop
      v_id := null;
      select id, boost_type, boost_value, uses_remaining
        into v_id, v_type, v_value, v_remaining
      from active_boosters
      where user_id = p_user_id
        and boost_type = v_effect
        and uses_remaining > 0
      order by activated_at asc
      for update skip locked
      limit 1;

      if v_id is not null then
        if v_remaining - 1 <= 0 then
          -- Last use - delete the row (mirrors activate-booster PATCH consume).
          delete from active_boosters where id = v_id and user_id = p_user_id;
        else
          update active_boosters
            set uses_remaining = uses_remaining - 1
          where id = v_id and user_id = p_user_id;
        end if;

        v_consumed := v_consumed || jsonb_build_object(
          'effect', v_type,
          'value', v_value,
          'booster_id', v_id
        );
      end if;
    end loop;
  end if;

  -- Record the consumed set for this attempt. ON CONFLICT DO NOTHING so a
  -- concurrent same-attempt caller (rare) converges on whichever row landed
  -- first; we then re-SELECT and return that authoritative set.
  insert into quiz_booster_consumption (attempt_id, user_id, consumed)
  values (p_attempt_id, p_user_id, v_consumed)
  on conflict (user_id, attempt_id) do nothing;

  select consumed into v_existing
  from quiz_booster_consumption
  where attempt_id = p_attempt_id and user_id = p_user_id;

  return coalesce(v_existing, v_consumed);
end;
$$;

revoke execute on function public.consume_quiz_boosters(uuid, uuid, text[]) from public, authenticated, anon;
grant execute on function public.consume_quiz_boosters(uuid, uuid, text[]) to service_role;
