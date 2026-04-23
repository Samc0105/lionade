-- Migration 032: Subscription plan column on profiles
--
-- Adds a `plan` column to `profiles` for subscription gating. Defaults to
-- 'free'. Stripe wiring lands later; for now, 'pro' and 'platinum' values
-- can be set manually on the row for dogfooding / team accounts.
--
-- Used by:
--   - Mastery Mode "Download Study Sheet" — paywalled behind 'pro' or 'platinum'
--
-- Client reads this via the normal profiles select, so RLS policies on
-- profiles already cover it (users can read their own row).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'platinum'));

-- Cheap index for admin "list paying users" queries later.
CREATE INDEX IF NOT EXISTS idx_profiles_plan
  ON profiles(plan) WHERE plan <> 'free';
