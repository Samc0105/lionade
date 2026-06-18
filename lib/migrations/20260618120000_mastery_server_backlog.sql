-- 20260618120000_mastery_server_backlog.sql
-- ============================================================
-- WEB migration: Mastery server backlog fixes (two RPCs).
-- RUN MANUALLY (Sam) via the Supabase SQL editor. UNAPPLIED.
-- No app code applies this; the routes call these RPCs with a defensive
-- fallback to the current behavior when the function is missing (PostgREST
-- PGRST202 / Postgres 42883), so the route code is safe to merge BEFORE this
-- migration is applied.
-- Sorts AFTER 20260617120000_fk_perf_indexes.sql.
--
-- Fully idempotent: every function uses CREATE OR REPLACE, so this is safe to
-- re-run. search_path is pinned to public on every function. All three are
-- SECURITY DEFINER and granted ONLY to service_role (no anon / authenticated
-- EXECUTE), so RLS-protected callers cannot invoke them directly.
--
-- ── ITEM 1: mastery-next-idempotency ─────────────────────────────────────────
-- WHY: POST /api/mastery/sessions/[id]/next is an unserialized read-modify-write
-- on the single JSONB column mastery_sessions.runtime_state. Two concurrent
-- calls (two tabs) both read pending===null, both generate + INSERT a question
-- card with its own challengeToken, and both blind-overwrite runtime_state.
-- Last write wins, so one card's challengeToken is never persisted in
-- runtime_state.pending — that card is permanently unanswerable (/answer rejects
-- it 409). The celebrate branch has the identical race on the boolean
-- reached_mastery_celebrated, so a duplicate celebrate card gets committed.
--
-- FIX: a per-session advisory lock that wraps a cheap check-and-claim. The lock
-- never spans the route's AI call; instead claim_mastery_next sets a short-lived
-- `next_claim` sentinel (60s TTL) that the route clears on its final
-- runtime_state write. A second tab arriving while the first is mid-generation
-- either adopts the live pending (outcome='resume') or is told to retry
-- (outcome='generating'). Mirrors claim_cooldown (069): pg_advisory_xact_lock
-- inside a SECURITY DEFINER service_role-only RPC. The lock auto-releases at the
-- end of this one-statement txn.

create or replace function public.claim_mastery_next(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending jsonb;
  v_claim   timestamptz;
begin
  -- One advisory xact lock per session; auto-releases at end of this txn.
  perform pg_advisory_xact_lock(hashtextextended('mastery_next:' || p_session_id::text, 0));

  select runtime_state->'pending', (runtime_state->>'next_claim')::timestamptz
    into v_pending, v_claim
  from mastery_sessions
  where id = p_session_id
  for update;  -- row lock too, belt-and-suspenders within the txn

  -- Already a live pending card → second tab adopts it.
  if v_pending is not null and v_pending <> 'null'::jsonb then
    return jsonb_build_object('outcome', 'resume', 'pending', v_pending);
  end if;

  -- Another caller is mid-generation (sentinel set < 60s ago) → tell client to wait.
  if v_claim is not null and v_claim > now() - interval '60 seconds' then
    return jsonb_build_object('outcome', 'generating');
  end if;

  -- Win the claim: drop a short-lived sentinel the route clears on its final write.
  update mastery_sessions
     set runtime_state = jsonb_set(runtime_state, '{next_claim}', to_jsonb(now()::text), true)
   where id = p_session_id;

  return jsonb_build_object('outcome', 'proceed');
end;
$$;

revoke execute on function public.claim_mastery_next(uuid) from public, anon, authenticated;
grant  execute on function public.claim_mastery_next(uuid) to service_role;

-- Celebrate double-fire guard: only ONE caller flips reached_mastery_celebrated.
-- The winner returns true (it inserts the celebrate message + mastery_events
-- row); every loser returns false and skips both inserts.
create or replace function public.claim_mastery_celebrate(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_done boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('mastery_next:' || p_session_id::text, 0));
  select coalesce((runtime_state->>'reached_mastery_celebrated')::boolean, false)
    into v_done from mastery_sessions where id = p_session_id for update;
  if v_done then return false; end if;
  update mastery_sessions
     set runtime_state = jsonb_set(runtime_state, '{reached_mastery_celebrated}', 'true'::jsonb, true)
   where id = p_session_id;
  return true;
end;
$$;

revoke execute on function public.claim_mastery_celebrate(uuid) from public, anon, authenticated;
grant  execute on function public.claim_mastery_celebrate(uuid) to service_role;

-- ── ITEM 2: mastery-complete-ledger ──────────────────────────────────────────
-- WHY: POST /api/mastery/sessions/[id]/complete credits Fangs via
-- update_user_coins (balance columns only) then writes the coin_transactions
-- audit row as a SEPARATE, unguarded insert. The two statements share no
-- transaction, so a transient failure of the second leaves coins incremented
-- with no ledger row — drifting the audit trail vs balance.
--
-- FIX: one SECURITY DEFINER RPC that does the cashable credit AND the
-- coin_transactions insert in a single plpgsql function body (one txn), so they
-- commit or roll back together. Models on credit_fang_iap (070) and the
-- 'cashable' branch of update_user_coins (072). Credit-only (no debit branch);
-- service_role-only. Migration 078's profiles guard allows auth.role()=
-- 'service_role' through, so the coins / fangs_cashable writes are NOT blocked.

create or replace function public.credit_user_coins_logged(
  p_user_id     uuid,
  p_delta       integer,
  p_source      text default 'cashable',
  p_type        text default 'reward',
  p_description text default null
)
returns table (new_coins integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_coins integer;
  v_role text := coalesce(auth.role(), '');
begin
  -- Server-only: this is a pure credit path (no debit branch), service-role only.
  if v_role <> 'service_role' then
    raise exception 'forbidden: service role only' using errcode = '42501';
  end if;
  if p_delta < 0 then
    raise exception 'invalid_delta: credit only (p_delta >= 0)' using errcode = 'P0001';
  end if;

  if p_source = 'cashable' then
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta)
      where id = p_user_id
      returning coins into v_new_coins;
  elsif p_source = 'iap' then
    update profiles
      set coins = coins + p_delta,
          fangs_iap = greatest(0, fangs_iap + p_delta)
      where id = p_user_id
      returning coins into v_new_coins;
  else
    raise exception 'invalid_source: %', p_source using errcode = 'P0001';
  end if;

  if v_new_coins is null then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  -- Same transaction as the balance update: they commit or roll back together.
  insert into coin_transactions (user_id, amount, type, description)
  values (p_user_id, p_delta, p_type, p_description);

  return query select v_new_coins;
end;
$$;

revoke execute on function public.credit_user_coins_logged(uuid, integer, text, text, text) from public, authenticated, anon;
grant  execute on function public.credit_user_coins_logged(uuid, integer, text, text, text) to service_role;
