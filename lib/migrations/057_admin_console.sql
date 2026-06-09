-- ============================================================
-- Migration 057: Admin Console — roles + audit log
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- NOT yet applied — Sam runs this manually. Fully idempotent; safe to re-run.
-- Until it runs, /api/admin/me treats every user as role='user' and the
-- Admin tab stays hidden.
-- ============================================================
--
-- What this migration adds:
--   1. `profiles.role` — TEXT NOT NULL DEFAULT 'user', CHECK user|support|admin
--   2. A BEFORE INSERT/UPDATE trigger that stops non-service-role callers from
--      changing `role`. CRITICAL: the existing "Users can update own profile"
--      RLS policy lets any signed-in user PATCH their own profiles row via
--      PostgREST — without this trigger anyone could set role='admin'.
--   3. `admin_audit_log` — immutable record of every admin action.
--      RLS: admin + support can read; only admin can write via client (in
--      practice all writes go through service role in /api/admin/* routes).
--   4. `current_app_role()` — SECURITY DEFINER helper so RLS policies can read
--      the caller's role without tripping over profiles' own RLS.
--   5. `admin_search_users(text)` — SECURITY DEFINER search across profiles +
--      auth.users (email search needs auth schema). service_role only.
--   6. `admin_dashboard_stats()` — one-round-trip dashboard metrics.
--      service_role only.

-- ── 1. role column ────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'support', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles (role)
  WHERE role <> 'user';

-- ── 2. role self-promotion guard ──────────────────────────────────────
-- Service role (supabaseAdmin in /api/admin/* routes) bypasses; everyone
-- else gets INSERTs forced to role='user' and UPDATEs that touch role
-- rejected. SQL-Editor sessions run as postgres (not 'authenticated'),
-- so manual role grants from the dashboard still work.
CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.role := 'user';
    ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'forbidden: role can only be changed by an admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_role ON profiles;
CREATE TRIGGER trg_guard_profile_role
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_role();

-- ── 3. current_app_role() helper for RLS ──────────────────────────────
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce((SELECT role FROM profiles WHERE id = auth.uid()), 'user');
$$;

REVOKE ALL ON FUNCTION public.current_app_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated, service_role;

-- ── 4. admin_audit_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performed_by   uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  action         text NOT NULL,
  target_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON admin_audit_log (target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor   ON admin_audit_log (performed_by);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read audit log" ON admin_audit_log;
CREATE POLICY "Staff can read audit log" ON admin_audit_log
  FOR SELECT USING (public.current_app_role() IN ('admin', 'support'));

DROP POLICY IF EXISTS "Admins can write audit log" ON admin_audit_log;
CREATE POLICY "Admins can write audit log" ON admin_audit_log
  FOR INSERT WITH CHECK (public.current_app_role() = 'admin');

-- No UPDATE/DELETE policies: the log is append-only for everyone but the
-- service role.

-- ── 5. admin_search_users ─────────────────────────────────────────────
-- Searches by email (auth.users), username, display_name, or exact UUID.
-- SECURITY DEFINER because auth.users is not reachable through PostgREST.
-- Granted to service_role ONLY — the /api/admin/users route enforces the
-- caller's staff role before invoking, and masks email for support staff.
CREATE OR REPLACE FUNCTION public.admin_search_users(search text, max_rows int DEFAULT 25)
RETURNS TABLE (
  id           uuid,
  username     text,
  display_name text,
  email        text,
  role         text,
  coins        integer,
  level        integer,
  plan         text,
  created_at   timestamptz,
  last_seen    timestamptz,
  banned_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id, p.username, p.display_name, u.email, p.role,
    p.coins, p.level, p.plan, p.created_at, p.last_seen,
    u.banned_until
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE
    search = '' OR
    u.email ILIKE '%' || search || '%' OR
    p.username ILIKE '%' || search || '%' OR
    p.display_name ILIKE '%' || search || '%' OR
    (search ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND p.id = search::uuid)
  ORDER BY p.created_at DESC
  LIMIT least(greatest(max_rows, 1), 100);
$$;

REVOKE ALL ON FUNCTION public.admin_search_users(text, int) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, int) TO service_role;

-- ── 6. admin_dashboard_stats ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS TABLE (
  total_users      bigint,
  signups_today    bigint,
  signups_week     bigint,
  active_today     bigint,
  active_week      bigint,
  fangs_total      bigint,
  fangs_cashable   bigint,
  fangs_iap        bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    count(*)                                                          AS total_users,
    count(*) FILTER (WHERE created_at >= date_trunc('day', now()))    AS signups_today,
    count(*) FILTER (WHERE created_at >= now() - interval '7 days')   AS signups_week,
    count(*) FILTER (WHERE last_seen  >= now() - interval '24 hours') AS active_today,
    count(*) FILTER (WHERE last_seen  >= now() - interval '7 days')   AS active_week,
    coalesce(sum(coins), 0)::bigint                                   AS fangs_total,
    coalesce(sum(fangs_cashable), 0)::bigint                          AS fangs_cashable,
    coalesce(sum(fangs_iap), 0)::bigint                               AS fangs_iap
  FROM profiles;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO service_role;
