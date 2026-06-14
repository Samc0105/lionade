-- ============================================================
-- Migration 068: Stripe webhook concurrency claim.
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY: the webhook recorded the dedup row AFTER dispatchHandler and only
-- short-circuited on status='processed'. Two concurrent/overlapping Stripe
-- deliveries both passed the read-only lookup and ran the handler twice — e.g.
-- crediting a Fang IAP twice for one payment. This adds a 'processing' claim
-- state and an atomic claim RPC so exactly one delivery owns the work, while
-- PRESERVING the existing errored-retry behavior (a previously-errored event,
-- or a 'processing' lock that went stale because the handler crashed, can be
-- re-claimed on the next Stripe retry).

alter table stripe_webhook_events
  drop constraint if exists stripe_webhook_events_status_check;
alter table stripe_webhook_events
  add constraint stripe_webhook_events_status_check
  check (status in ('processing', 'processed', 'errored'));

create or replace function public.claim_stripe_event(p_event_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  -- Win the claim by INSERTing a fresh 'processing' lock, OR by re-claiming a
  -- previously 'errored' event / a 'processing' lock gone stale (>5 min: the
  -- prior handler likely crashed). RETURNING is non-null only when we actually
  -- inserted or updated — i.e. THIS caller now owns the lock.
  insert into stripe_webhook_events (event_id, status, processed_at, error_message)
  values (p_event_id, 'processing', now(), null)
  on conflict (event_id) do update
    set status = 'processing', processed_at = now(), error_message = null
    where stripe_webhook_events.status = 'errored'
       or (stripe_webhook_events.status = 'processing'
           and stripe_webhook_events.processed_at < now() - interval '5 minutes')
  returning status into v_status;

  if v_status is not null then
    return 'claimed';
  end if;

  -- We did not win the claim: report why so the caller can short-circuit.
  select status into v_status from stripe_webhook_events where event_id = p_event_id;
  if v_status = 'processed' then
    return 'duplicate';
  end if;
  return 'in_progress';
end;
$$;

revoke execute on function public.claim_stripe_event(text) from public, authenticated, anon;
grant execute on function public.claim_stripe_event(text) to service_role;
