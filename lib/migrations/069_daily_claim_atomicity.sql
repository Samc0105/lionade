-- ============================================================
-- Migration 069: atomic daily-window claims (spin / login-bonus / place-bet).
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY: spin and login-bonus were check-then-act on a 24h ROLLING cooldown — two
-- concurrent POSTs both passed the read-check and double-paid (spin up to 800F +
-- a rare cosmetic; login-bonus the tiered+multiplied bonus). place-bet read "no
-- active bet" then inserted, so concurrent requests double-DEBITED and left two
-- active bets. This adds:
--   (1) reward_claims + claim_cooldown(): a reusable, advisory-lock-serialized
--       atomic claim for rolling-window rewards (spin, login-bonus).
--   (2) a partial UNIQUE so a user can hold at most one unresolved bet — the
--       second concurrent insert fails 23505 and place-bet refunds the debit.

create table if not exists reward_claims (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null,
  claimed_at  timestamptz not null default now()
);

create index if not exists idx_reward_claims_user_kind_time
  on reward_claims (user_id, kind, claimed_at desc);

alter table reward_claims enable row level security;
revoke all on reward_claims from anon;
revoke all on reward_claims from authenticated;
grant all on reward_claims to service_role;

-- Atomically claim a rolling-cooldown reward. Returns true iff THIS caller won
-- (no claim of this kind within p_cooldown_seconds). A per-(user,kind) advisory
-- xact lock serializes concurrent callers, so the exists-check + insert is
-- atomic — closing the check-then-act double-pay race.
create or replace function public.claim_cooldown(
  p_user_id uuid,
  p_kind text,
  p_cooldown_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_kind, 0));
  if exists (
    select 1 from reward_claims
    where user_id = p_user_id
      and kind = p_kind
      and claimed_at > now() - make_interval(secs => p_cooldown_seconds)
  ) then
    return false;
  end if;
  insert into reward_claims (user_id, kind) values (p_user_id, p_kind);
  return true;
end;
$$;

revoke execute on function public.claim_cooldown(uuid, text, integer) from public, authenticated, anon;
grant execute on function public.claim_cooldown(uuid, text, integer) to service_role;

-- At most one unresolved bet per user.
create unique index if not exists uq_daily_bets_one_active
  on daily_bets (user_id) where resolved_at is null;
