-- Stripe subscription columns on profiles + webhook idempotency table.
--
-- WHY: until today, paid tier was a manually-bumped `profiles.plan` value.
-- Customers were emailing support to subscribe because the pricing CTAs were
-- mailto: placeholders. This migration is the DB side of the Stripe wiring:
-- the columns the webhook writes into, the idempotency table that lets the
-- webhook return 200 immediately on Stripe's retry storms, and column-level
-- privilege revokes so the user's own session JWT cannot forge a paid tier
-- (only `service_role` via the webhook handler can mutate the billing
-- columns).

alter table profiles
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'pro', 'platinum')),
  add column if not exists subscription_status text
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists subscription_cancel_at timestamptz,
  add column if not exists subscription_cycle text
    check (subscription_cycle in ('monthly', 'annual'));

create index if not exists idx_profiles_stripe_customer_id
  on profiles(stripe_customer_id) where stripe_customer_id is not null;

-- Lock down user-side writes to the billing columns via COLUMN-LEVEL GRANTS,
-- not RLS subqueries.
--
-- Why column grants and NOT a `with check` RLS policy that subqueries the
-- same row: Postgres can resolve the `select ... from profiles where id =
-- auth.uid()` subquery against the POST-update value AND re-enter RLS, so a
-- naive "billing_col is not distinct from (select billing_col from
-- profiles ...)" check can silently pass even when the user mutated the
-- value. Column privileges are unambiguous, do not re-enter RLS, and the
-- service role bypasses them anyway so the webhook keeps full write access.
--
-- The existing `profiles_owner_update` RLS policy is preserved for the
-- columns users CAN edit (display_name, avatar_url, etc.). We only strip
-- UPDATE privilege on the billing columns from the `authenticated` role.
revoke update (
  stripe_customer_id,
  stripe_subscription_id,
  subscription_tier,
  subscription_status,
  subscription_current_period_end,
  subscription_cancel_at,
  subscription_cycle
) on profiles from authenticated;

-- Defense in depth: also revoke from anon (anon should never UPDATE profiles
-- anyway thanks to RLS, but make the privilege model self-documenting).
revoke update (
  stripe_customer_id,
  stripe_subscription_id,
  subscription_tier,
  subscription_status,
  subscription_current_period_end,
  subscription_cancel_at,
  subscription_cycle
) on profiles from anon;

-- Webhook idempotency: Stripe retries on any 5xx (or no-response) for up to
-- 3 days. Without dedup we'd double-credit subscription.created on every
-- retry. The webhook checks `status` before processing:
--   - row missing                          → process, then insert 'processed'
--   - row present, status = 'processed'    → short-circuit 200 duplicate
--   - row present, status = 'errored'      → re-process; previous attempt failed
-- `error_message` stores the failure tail (sliced server-side) for Sam to
-- grep in Vercel logs when triaging a stuck event.
create table if not exists stripe_webhook_events (
  event_id text primary key,
  status text not null default 'processed'
    check (status in ('processed', 'errored')),
  error_message text,
  processed_at timestamptz not null default now()
);

alter table stripe_webhook_events enable row level security;
-- No policies: service-role only. The webhook handler uses supabaseAdmin
-- which bypasses RLS; no client should ever read this table.

-- Backfill the new `subscription_tier` column from the legacy `plan` column
-- for any users who were manually grandfathered to a paid tier (Sam
-- bumping `plan='pro'` by hand pre-Stripe). They have no Stripe customer
-- record so `subscription_status` / `subscription_current_period_end` /
-- `stripe_customer_id` stay null — but their tier is honored so existing
-- multipliers and gates keep working until they migrate through Checkout.
update profiles
  set subscription_tier = plan
  where plan in ('pro', 'platinum')
    and subscription_tier = 'free';
