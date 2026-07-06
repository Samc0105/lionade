-- 20260706200000_spend_iap_clamp.sql
-- ============================================================
-- Clamp the 'spend' branch's fangs_iap overflow arm at zero.
-- ============================================================
--
-- WHY: the 'spend' source debits fangs_cashable first and lets the remainder
-- overflow into fangs_iap. That overflow arm was UNCLAMPED:
--
--   fangs_iap + (fangs_cashable + p_delta)
--
-- which assumes the buckets always cover the spend whenever coins does (the
-- dual-ledger invariant coins = fangs_cashable + fangs_iap). If the buckets
-- ever skew from coins — which happened 2026-07-06 via a manual credit that
-- bumped coins without bumping a bucket — a spend that passes the coins
-- min-balance check can drive fangs_iap negative, violating the
-- profiles_fangs_iap_nonneg CHECK constraint. The UPDATE then errors and
-- EVERY purchase 500s for that user until someone hand-repairs the row.
--
-- FIX: greatest(0, fangs_iap + (fangs_cashable + p_delta)). coins (the balance
-- source of truth — every route reads and gates on coins) stays exact; bucket
-- drift degrades gracefully (fangs_iap floors at 0, matching the greatest(0,..)
-- clamp the cashable arm already has) instead of hard-failing the purchase.
-- Drift is then observable via the invariant query below and repairable
-- offline, with no user-facing outage in the meantime.
--
-- ONE-CHANGE GUARANTEE: this is byte-identical to the current prod definition
-- (lib/migrations/20260702090000_web_features_ledger_types.sql, the 'tip_spend'
-- superset of 072) except for the single greatest(0, ...) wrap in the 'spend'
-- branch's fangs_iap CASE arm. All security guards (service-role check,
-- caller==user check, spend-only + negative-delta-only for non-service
-- callers), all five source branches, SECURITY DEFINER, search_path, and the
-- revoke/grant pair are reproduced unchanged. CREATE OR REPLACE keeps it
-- idempotent.
--
-- OPS — dual-ledger invariant check (coins is the source of truth; buckets
-- should sum to it). Run in the SQL editor; expect 0. Any rows it returns are
-- drifted and should be repaired by adjusting the buckets to match coins:
--
--   select count(*) as drifted_profiles
--   from profiles
--   where coins <> fangs_cashable + fangs_iap;
--
--   -- Detail view for repair, if the count is nonzero:
--   -- select id, coins, fangs_cashable, fangs_iap,
--   --        coins - (fangs_cashable + fangs_iap) as drift
--   -- from profiles
--   -- where coins <> fangs_cashable + fangs_iap;

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
  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden: caller % cannot mutate user %', auth.uid(), p_user_id
        using errcode = '42501';
    end if;
    if p_source <> 'spend' then
      raise exception 'forbidden: non-service caller may only call source=spend'
        using errcode = '42501';
    end if;
    if p_delta >= 0 then
      raise exception 'forbidden: non-service caller may only debit (p_delta < 0)'
        using errcode = '42501';
    end if;
  end if;

  if p_min_balance < 0 then
    raise exception 'invalid_min_balance: must be >= 0'
      using errcode = 'P0001';
  end if;

  if p_source = 'cashable' then
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'iap' then
    update profiles
      set coins = coins + p_delta,
          fangs_iap = greatest(0, fangs_iap + p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'spend' then
    -- fangs_iap overflow arm clamped at 0 (the ONE change in this migration):
    -- if bucket drift means cashable+iap can't cover the spend even though
    -- coins can, floor iap at 0 instead of violating profiles_fangs_iap_nonneg.
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta),
          fangs_iap = case
                        when fangs_cashable + p_delta < 0
                        then greatest(0, fangs_iap + (fangs_cashable + p_delta))
                        else fangs_iap
                      end,
          lifetime_fangs_spent = lifetime_fangs_spent + abs(p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'spend_refund' then
    -- Reverse a prior spend. p_delta is expected POSITIVE (a credit). Credits
    -- cashable and unwinds the lifetime spend counter (clamped at 0).
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta),
          lifetime_fangs_spent = greatest(0, lifetime_fangs_spent - abs(p_delta))
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'tip_spend' then
    -- Fang tip debit. CASHABLE ONLY — never dips into fangs_iap (blocks
    -- iap -> cashable laundering through the tip credit) and does NOT touch
    -- lifetime_fangs_spent (tips are transfers, not consumption — counting
    -- them would let paired accounts pump the cash-out eligibility gate).
    -- The fangs_cashable guard makes "not enough cashable" raise
    -- insufficient_coins instead of clamping.
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = fangs_cashable + p_delta
      where id = p_user_id
        and coins + p_delta >= p_min_balance
        and fangs_cashable + p_delta >= 0
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

revoke execute on function public.update_user_coins(uuid, integer, integer, text) from public, authenticated, anon;
grant execute on function public.update_user_coins(uuid, integer, integer, text) to service_role;
