-- founder_grants: add `source` + `reference_id` columns.
--
-- These columns ALREADY EXIST in production (the committed Stripe subscription
-- grant path — tryGrantFoundingScholar — and /api/shop/purchase both insert
-- them today and work in prod). But the original table migration
-- (supabase/migrations/20260603154104_shop_v2_identity.sql) never declared
-- them, so the repo migrations could not reproduce the live schema: a fresh DB
-- rebuilt purely from migrations would throw "column does not exist" on every
-- founder grant. This idempotent ALTER closes that source-of-truth gap.
--
-- STATUS: HELD / safe to run. IF NOT EXISTS makes it a no-op against prod
-- (which already has the columns). Owner: Sam applies via Supabase.
--
--   source        — how the badge was granted: 'stripe_subscription' (the
--                   first-1000 Pro perk), 'stripe_purchase' (the new USD
--                   $14.99 bundle), 'purchase' (Fangs path), 'backfill', etc.
--   reference_id  — the originating Stripe subscription id / checkout session
--                   id, for audit + idempotency tracing.

ALTER TABLE public.founder_grants
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS reference_id text;
