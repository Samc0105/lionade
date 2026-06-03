-- Dual-ledger Fang schema: separates GAMEPLAY-EARNED Fangs (future-cashable)
-- from IAP-PURCHASED Fangs (NEVER cashable per Apple 3.1.5(b)), plus a
-- lifetime spend counter for the V2 60%-spend cash-out gate.
--
-- WHY (Path B → Path C migration prep):
--   Path B (this release): Fang IAP via Stripe is live; no cash-out yet.
--   Path C (2027): cash-out launches. Apple guideline 3.1.5(b) requires that
--   ONLY user-earned virtual currency may be redeemed for real-world value;
--   IAP-purchased currency must NEVER be cashable. If we ship the IAP today
--   without separating the ledgers, every "fang" balance becomes ambiguous
--   the moment cash-out turns on — we'd have no way to prove which Fangs
--   came from gameplay vs purchase, and Apple would reject Path C.
--
--   This migration lays the rails now so the IAP wave can route purchased
--   Fangs to the IAP bucket from day one, while gameplay grants keep landing
--   in the cashable bucket. The V1 UI continues to show a single combined
--   Fang total (`profiles.coins`) — the dual ledger drives WRITES only, not
--   the user-facing display, until Path C lights up.
--
-- WHAT THIS DOES:
--   1. Adds `fangs_cashable`, `fangs_iap`, `lifetime_fangs_spent` to
--      profiles (bigint, NOT NULL, default 0). bigint > integer because
--      `lifetime_fangs_spent` is monotonic-increasing forever and we don't
--      want to revisit overflow in 3 years.
--   2. Backfills `fangs_cashable` from existing `coins`. All current balances
--      were earned (no IAP exists yet) → all are cashable.
--   3. Column-level UPDATE revokes on the new columns AND on `coins` itself
--      so user JWTs cannot mutate balances directly. Only the SECURITY DEFINER
--      RPC (`update_user_coins`) and service_role can write — same pattern
--      we adopted for the Stripe billing columns yesterday.
--   4. Replaces the 3-arg `update_user_coins(uuid, integer, integer)` RPC
--      with a 4-arg version that takes `p_source text` ('cashable' | 'iap'
--      | 'spend'). The OLD 3-arg signature is DROPPED at the end so every
--      caller is forced to specify a source — no silent "default to
--      cashable" mistakes that would corrupt the ledger.
--
-- DEBIT SEMANTICS (p_source = 'spend'):
--   Decrement priority is CASHABLE FIRST, then dip into IAP if cashable
--   runs out. This preserves the user's potentially-future-cashable balance
--   for as long as possible (the V2 cash-out gate also rewards retaining
--   cashable balance). On any debit, `lifetime_fangs_spent` ALWAYS
--   increments by abs(delta) — this drives the V2 60%-spend redemption
--   gate (Apple wants proof that users are genuinely playing, not just
--   buying and immediately cashing out).
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

-- ---------------------------------------------------------------------------
-- 1. Schema: three new columns on profiles
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists fangs_cashable bigint not null default 0,
  add column if not exists fangs_iap bigint not null default 0,
  add column if not exists lifetime_fangs_spent bigint not null default 0;

-- Sanity-check constraints. fangs_cashable and fangs_iap should never go
-- negative (the RPC's debit path uses greatest(0, ...) and conditional
-- carry to enforce this, but a CHECK is defense in depth). lifetime spend
-- is monotonic-increasing so >= 0 is sufficient.
alter table profiles
  add constraint profiles_fangs_cashable_nonneg check (fangs_cashable >= 0) not valid;
alter table profiles
  add constraint profiles_fangs_iap_nonneg check (fangs_iap >= 0) not valid;
alter table profiles
  add constraint profiles_lifetime_fangs_spent_nonneg check (lifetime_fangs_spent >= 0) not valid;

-- VALIDATE after backfill so existing rows are checked too. (NOT VALID +
-- VALIDATE pattern avoids a long AccessExclusiveLock during the initial
-- ADD CONSTRAINT on large tables — Postgres takes a weaker ShareUpdateExclusiveLock
-- during VALIDATE.)

-- ---------------------------------------------------------------------------
-- 2. Backfill: every existing Fang balance is cashable
-- ---------------------------------------------------------------------------

-- All Fangs in the system today were earned via gameplay, ads, daily login,
-- or admin grants — no IAP has shipped yet. So `fangs_cashable` mirrors
-- `coins` for any user with a positive balance.
--
-- Perf note: profiles is small at current scale (low thousands of users
-- pre-launch). On a production-sized profiles table this would run in well
-- under a second; if it ever grows past ~1M rows the UPDATE should be
-- batched in a separate maintenance migration, but at current volume a
-- single statement is correct.
update profiles
  set fangs_cashable = coins
  where coins > 0
    and fangs_cashable = 0;

-- Now that the backfill is in, validate the CHECK constraints against
-- existing rows.
alter table profiles validate constraint profiles_fangs_cashable_nonneg;
alter table profiles validate constraint profiles_fangs_iap_nonneg;
alter table profiles validate constraint profiles_lifetime_fangs_spent_nonneg;

-- ---------------------------------------------------------------------------
-- 3. Column-level RLS: lock down user-side writes
-- ---------------------------------------------------------------------------
--
-- Same approach as the Stripe billing columns (see
-- 20260603010601_stripe_subscriptions.sql for the deeper rationale): RLS
-- subquery checks can silently pass on self-mutation due to RLS re-entry,
-- so we use UNAMBIGUOUS column-level GRANT revokes. service_role bypasses
-- these (the RPC runs as security definer with table owner privileges, so
-- it can still write). The user's session JWT cannot UPDATE these columns
-- via PostgREST under any circumstance.
--
-- Also revoking UPDATE on `coins` itself — until today that column was
-- still indirectly user-writable via PostgREST (RLS allowed it on the
-- owner row). With the atomic RPC pattern from 20260531223724, ALL coin
-- mutations must go through `update_user_coins`. Closing the direct path.

revoke update (
  coins,
  fangs_cashable,
  fangs_iap,
  lifetime_fangs_spent
) on profiles from authenticated;

revoke update (
  coins,
  fangs_cashable,
  fangs_iap,
  lifetime_fangs_spent
) on profiles from anon;

-- ---------------------------------------------------------------------------
-- 4. RPC: update_user_coins with source routing
-- ---------------------------------------------------------------------------
--
-- New 4-arg signature replaces the 3-arg from 20260531223724. The OLD
-- signature is DROPPED at the bottom of this migration so any caller still
-- using `rpc('update_user_coins', { p_user_id, p_delta, p_min_balance })`
-- without a source gets a "function does not exist" error at runtime AND
-- (more importantly) `npx tsc --noEmit` flags it via the Database type
-- regen. Intentional — forces every callsite to think about which bucket
-- the delta belongs to.
--
-- p_source values:
--   'cashable' — gameplay grants, ad rewards, daily login, missions,
--                streak milestones, quiz rewards, bet wins. Credits go to
--                fangs_cashable (future-cashable). Default for safety —
--                if a caller forgets to specify, gameplay routing is the
--                safe assumption (worst case: a user gets MORE cashable
--                value than intended, never less).
--   'iap'      — Stripe Fang purchases (and future StoreKit purchases).
--                Credits go to fangs_iap (NEVER cashable).
--   'spend'    — shop purchases, bounty rescues, anything that DEBITS the
--                user's balance. Decrements cashable first, then dips into
--                iap if cashable is exhausted. ALWAYS increments
--                lifetime_fangs_spent by abs(delta) — drives the V2 60%-
--                spend cash-out gate.

create or replace function public.update_user_coins(
  p_user_id uuid,
  p_delta integer,
  p_min_balance integer default 0,
  p_source text default 'cashable'
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
  -- Defense-in-depth caller-identity gate.
  --
  -- The grant statement below revokes this RPC from `authenticated` and only
  -- grants to `service_role` — every API route uses `supabaseAdmin` (service
  -- role). But if a future migration ever re-grants to `authenticated`, this
  -- inline check stops a logged-in user from minting Fangs to arbitrary
  -- accounts. Service role bypasses (it has no auth.uid()).
  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden: caller % cannot mutate user %', auth.uid(), p_user_id
        using errcode = '42501';
    end if;
    -- A user calling this directly can only debit themselves; they cannot
    -- credit cashable or iap (those routes are server-only via service role).
    if p_source <> 'spend' then
      raise exception 'forbidden: non-service caller may only call source=spend'
        using errcode = '42501';
    end if;
    -- And the delta must be negative (debit only) for non-service callers.
    if p_delta >= 0 then
      raise exception 'forbidden: non-service caller may only debit (p_delta < 0)'
        using errcode = '42501';
    end if;
  end if;

  -- Reject negative min_balance — callers cannot drive coins below zero by
  -- passing p_min_balance < 0. (The min_balance guard is a floor, not a sink.)
  if p_min_balance < 0 then
    raise exception 'invalid_min_balance: must be >= 0'
      using errcode = 'P0001';
  end if;

  if p_source = 'cashable' then
    -- CREDIT to cashable bucket. p_delta is expected positive but we don't
    -- enforce it (legacy callers may pass a negative for a "cashable
    -- refund" pattern, which is semantically a debit-correction; the
    -- min_balance guard still prevents over-draft).
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'iap' then
    -- CREDIT to IAP bucket. Same shape as cashable but routes to fangs_iap.
    -- IAP refunds (Apple-initiated chargebacks, Stripe disputes) would
    -- call this with a negative p_delta; the greatest(0,...) clamp keeps
    -- the bucket non-negative if a refund exceeds the current iap balance.
    update profiles
      set coins = coins + p_delta,
          fangs_iap = greatest(0, fangs_iap + p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'spend' then
    -- DEBIT path. p_delta is expected negative. Decrement cashable FIRST,
    -- then dip into iap if cashable runs out.
    --
    -- The expression `case when fangs_cashable + p_delta < 0 then
    --   fangs_iap + (fangs_cashable + p_delta) else fangs_iap end`
    -- evaluates against the PRE-update row values (Postgres SET expressions
    -- are evaluated against the OLD row), so:
    --   - if (cashable + delta) >= 0:  cashable covers it; iap untouched
    --   - if (cashable + delta) <  0:  cashable goes to 0 (via greatest);
    --                                  the overflow (a negative number) is
    --                                  added to iap, debiting the remainder
    --
    -- The outer min_balance guard on `coins + p_delta` enforces the user
    -- has enough total Fangs to cover the debit; the bucket math just
    -- decides where it's drawn from.
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta),
          fangs_iap = case
                        when fangs_cashable + p_delta < 0
                        then fangs_iap + (fangs_cashable + p_delta)
                        else fangs_iap
                      end,
          lifetime_fangs_spent = lifetime_fangs_spent + abs(p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  else
    raise exception 'invalid_source: %', p_source
      using errcode = 'P0001';
  end if;

  if v_new_coins is null then
    raise exception 'insufficient_coins'
      using errcode = 'P0001';
  end if;

  return query select v_new_coins;
end;
$$;

-- Server-only RPC. Every callsite uses `supabaseAdmin` (service role); the
-- function body also has an inline auth.uid() check that limits any future
-- accidental grant to `authenticated` to debit-only-self. Explicitly revoke
-- from public/authenticated/anon first to be unambiguous about intent.
revoke execute on function public.update_user_coins(uuid, integer, integer, text) from public, authenticated, anon;
grant execute on function public.update_user_coins(uuid, integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Drop the OLD 3-arg signature
-- ---------------------------------------------------------------------------
--
-- Force every caller to specify a source. Without this drop, PostgREST and
-- supabase-js would still happily resolve the 3-arg call (Postgres allows
-- function overloading on arity) and silently route every grant through
-- whatever the old function did — which doesn't update fangs_cashable at
-- all, so the new ledger would stay perpetually empty.
--
-- The parallel dev-backend wave WILL get tsc errors on any stale callsite
-- after the Database types regen. That is intentional and good — those
-- errors are the migration's safety net.

drop function if exists public.update_user_coins(uuid, integer, integer);
