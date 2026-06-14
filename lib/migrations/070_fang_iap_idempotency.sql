-- ============================================================
-- Migration 070: per-payment idempotency for Fang IAP credits.
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY (review follow-up to migration 068): the stripe webhook's 5-min stale-lock
-- self-heal (claim_stripe_event) can re-run handleFangIapPayment, and
-- update_user_coins has NO per-payment dedup — so a slow-then-killed handler
-- could credit a Fang pack twice for one payment. credit_fang_iap does the
-- idempotency-gate insert + the iap credit in ONE transaction: a duplicate
-- Stripe session conflicts on the partial UNIQUE and returns false WITHOUT
-- crediting, and a mid-function crash rolls the whole thing back (no partial
-- state, so a Stripe retry re-credits cleanly).

create unique index if not exists uq_coin_tx_fang_iap_ref
  on coin_transactions (reference_id)
  where type = 'fang_iap_purchase' and reference_id is not null;

create or replace function public.credit_fang_iap(
  p_user_id uuid,
  p_amount integer,
  p_session_id text,
  p_description text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Idempotency gate + audit row in one shot. A duplicate session conflicts on
  -- uq_coin_tx_fang_iap_ref and trips the exception handler below.
  insert into coin_transactions (user_id, amount, type, reference_id, description)
  values (p_user_id, p_amount, 'fang_iap_purchase', p_session_id, p_description);

  -- Credit the IAP bucket (Apple 3.1.5(b): IAP fangs are non-cashable). Same
  -- shape as update_user_coins(p_source='iap'), inlined here so the credit and
  -- the dedup row commit (or roll back) together.
  update profiles
    set coins = coins + p_amount,
        fangs_iap = greatest(0, fangs_iap + p_amount)
    where id = p_user_id;

  return true;
exception
  when unique_violation then
    -- Already credited on a prior delivery. No-op (this tx is rolled back).
    return false;
end;
$$;

revoke execute on function public.credit_fang_iap(uuid, integer, text, text) from public, authenticated, anon;
grant execute on function public.credit_fang_iap(uuid, integer, text, text) to service_role;
