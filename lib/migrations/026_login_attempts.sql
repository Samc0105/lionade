-- Migration 026: Login Attempts Table
--
-- Tracks brute-force login attempts. The /api/auth/check-lock endpoint reads this
-- to decide whether to lock an email after N failed attempts in a window.
-- Without this table, brute-force protection silently fails open.
--
-- Retention is unbounded here; a periodic purge job (or Supabase cron) should
-- delete rows older than 30 days to keep the table small. Add it later.

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT
);

-- Fast lookup by (email, success, attempted_at) for the check-lock query:
--   SELECT count(*) FROM login_attempts
--   WHERE email = $1 AND success = false AND attempted_at >= $2
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_failed
  ON login_attempts (email, attempted_at DESC)
  WHERE success = false;

-- This table is read/written ONLY by server routes using the service-role key.
-- Clients must never touch it, so RLS stays enabled with no policies.
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
