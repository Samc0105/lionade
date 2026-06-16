-- 20260616150000_feature_flags.sql
-- ============================================================
-- Feature flags: a WEB-ONLY admin kill-switch / maintenance system.
-- RUN MANUALLY (Sam) via the Supabase SQL editor. No app code applies this;
-- the routes that read this table ship separately and tolerate the table
-- being absent (a missing table reads as "no rows" => everything is live).
-- Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY this migration exists / how it is meant to be used:
--
--   An admin can flip any product surface (a page, a card, a game mode) into
--   'maintenance' from /admin/features, optionally attaching a user-facing
--   message and an ETA. Public reads happen through the SERVICE ROLE only
--   (the /api/feature-flags route and the server-side assertFeatureLive
--   helper). anon never touches this table directly.
--
--   FAIL-OPEN is the whole design philosophy: a monitoring / maintenance
--   system must never itself be able to take the site down. If this table is
--   unreadable for any reason (DB error, missing table, network), every
--   caller treats every feature as live. The same principle is encoded in
--   the data model: NO ROW FOR A KEY = LIVE (the safe default). A feature is
--   only ever "down" when an admin has explicitly inserted a row with
--   status='maintenance'.
--
--   Recovery surfaces (/admin/*, /login, /signup, /onboard/*, /settings/*,
--   the auth/account/quiz-core APIs, the Navbar, and the feature-flag system
--   itself) are NEVER gateable. That exclusion lives in the app-side catalog
--   (lib/features/catalog.ts) by construction; this table only stores rows
--   for keys the catalog allows, and the admin POST route rejects any key
--   that is not in the catalog. The DB intentionally does not hard-code the
--   catalog so the app can evolve it without a migration.
--
-- This migration references public.current_app_role() defined in migration
-- 057 (admin_console). It does NOT redefine it.
--
-- New admin_audit_log action verb introduced by this feature:
--   feature_flag_change
--     metadata: { key, to: 'live'|'maintenance', message, eta }
-- (admin_audit_log.action is free text; documented here, not constrained.)

-- ─────────────────────────────────────────────────────────────────────────
-- 1. feature_flags — one row per overridden feature key. Absent row = live.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.feature_flags (
  key        text primary key,
  status     text not null default 'live' check (status in ('live', 'maintenance')),
  message    text,
  eta        text,
  -- Nullable + SET NULL so deleting the admin's profile never fails and never
  -- erases the flag itself.
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.feature_flags is
  'Admin kill-switch / maintenance overrides, one row per feature key. NO ROW = LIVE (safe default). Read by the service role only; anon is revoked. Fail-open: unreadable => treat everything as live.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.feature_flags_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_feature_flags_updated_at on public.feature_flags;
create trigger trg_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute function public.feature_flags_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS — admin-only FOR ALL via public.current_app_role() = 'admin'.
--    anon fully revoked; authenticated granted (still gated by the policy).
--    service_role bypasses RLS (BYPASSRLS) for the privileged public reads
--    and the admin writes from the node-runtime routes. Public reads ALWAYS
--    go through the service role, NEVER anon.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.feature_flags enable row level security;

drop policy if exists feature_flags_admin_all on public.feature_flags;
create policy feature_flags_admin_all on public.feature_flags
  for all
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

revoke all on public.feature_flags from anon;
grant select, insert, update, delete on public.feature_flags to authenticated;
