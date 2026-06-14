-- ============================================================
-- Migration 072: add a 'spend_refund' source to update_user_coins.
-- Applied to production via Supabase MCP. Fully idempotent (CREATE OR REPLACE).
-- ============================================================
--
-- WHY: refunds of a prior 'spend' were crediting p_source='cashable', which (a)
-- never unwound lifetime_fangs_spent (corrupting the V2 60%-spend cash-out gate)
-- and (b) always landed in cashable even when the original spend dipped into iap.
-- 'spend_refund' credits back to cashable AND decrements lifetime_fangs_spent by
-- abs(delta), reversing the spend's accounting. (Full per-spend cashable/iap
-- proportion restoration would need per-transaction split tracking — a V2
-- refinement; crediting cashable is correct in the common case since 'spend'
-- decrements cashable first, and the iap split has no user impact pre-cash-out.)
--
-- This is a STRICT SUPERSET of the existing 4-arg function: every other branch
-- (cashable / iap / spend) is byte-identical to migration 20260603013600; only
-- the new 'spend_refund' elsif and this comment are added.

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
