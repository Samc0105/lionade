-- Migration 048: Track welcome-email send per user.
--
-- Adds `welcome_email_sent_at timestamptz` to `profiles`. The Supabase Auth
-- "email-verified" webhook (Phase 1.5) fires once per signup-verify, but we
-- still need server-side idempotency in case:
--   (a) Supabase retries a failed webhook delivery, OR
--   (b) the webhook is replayed for any reason, OR
--   (c) a future client-side fallback fires alongside the webhook.
--
-- Defense-in-depth — the receiving route at app/api/auth/welcome/route.ts
-- reads this column, no-ops with 204 if set, sends + stamps if null.
--
-- No backfill: existing accounts (pre-2026-05-25) won't get a retroactive
-- welcome email. That's intentional — surfacing a "welcome" email to a user
-- who's been using the app for weeks is worse than silence.
--
-- profiles already has RLS enabled (migration 001). No new policies needed:
-- the welcome route writes via supabaseAdmin (service role, bypasses RLS),
-- and no client surface reads this column.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

-- Optional partial index — only useful if we ever build a "which users haven't
-- received their welcome" admin query. Cheap (one bool predicate, sparse).
CREATE INDEX IF NOT EXISTS idx_profiles_welcome_email_pending
  ON profiles (id)
  WHERE welcome_email_sent_at IS NULL;

COMMENT ON COLUMN profiles.welcome_email_sent_at IS
  'Timestamp the welcome email was sent. NULL = not yet sent. Stamped by app/api/auth/welcome/route.ts on successful Resend send. Replay-safe via this column.';
