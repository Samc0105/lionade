-- Atomic Fang (coins) balance mutation RPC.
--
-- WHY: Every coin mutation across the codebase today is a read-modify-write
-- (`select coins → coins ± delta → update`). Two parallel tabs can both read
-- the same starting value, both write the same new value, and the user
-- effectively duplicates their balance (on credits) or escapes a debit
-- (on charges). The 2026-05-31 security audit flagged 5 routes.
--
-- This RPC applies the delta in a single UPDATE statement with a
-- `coins + p_delta >= p_min_balance` predicate. If the predicate fails
-- (insufficient funds) the row is not updated and the function raises
-- `insufficient_coins` (SQLSTATE P0001), which the API layer maps to a
-- 400/409. On success the new balance is returned, so callers don't need
-- to re-fetch.
--
-- security definer + locked search_path so it runs with table-owner privileges
-- regardless of who calls it (supabaseAdmin or authenticated user via service
-- role). RLS on `profiles` therefore cannot block the update; the function
-- itself is the trust boundary.

create or replace function public.update_user_coins(
  p_user_id uuid,
  p_delta integer,
  p_min_balance integer default 0
)
returns table (new_coins integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_coins integer;
begin
  update profiles
    set coins = coins + p_delta
    where id = p_user_id
      and coins + p_delta >= p_min_balance
    returning coins into v_new_coins;

  if v_new_coins is null then
    raise exception 'insufficient_coins'
      using errcode = 'P0001';
  end if;

  return query select v_new_coins;
end;
$$;

grant execute on function public.update_user_coins(uuid, integer, integer) to authenticated, service_role;
