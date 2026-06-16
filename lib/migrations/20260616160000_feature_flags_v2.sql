-- 20260616160000_feature_flags_v2.sql
-- ============================================================
-- Kill-switch v2: extends the WEB-ONLY admin feature-flag system from
-- 20260616150000_feature_flags.sql with (a) a third 'warning' status,
-- (b) a scheduling window (starts_at / ends_at), and (c) a dedup ledger
-- for the SOC security-alert cron.
-- RUN MANUALLY (Sam) via the Supabase SQL editor. No app code applies this;
-- the routes that read these objects ship separately and tolerate them being
-- absent (a missing column / table reads as "no override" => everything live).
-- Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY this migration exists / how it is meant to be used:
--
--   v1 gave every product surface two states: live or maintenance. v2 adds a
--   middle state and time-boxing:
--
--     'live'        normal operation (the absent-row default stays 'live').
--     'warning'     the feature is STILL USABLE. The app shows a dismissible
--                   "known issue" banner above it. The API is NOT blocked.
--     'maintenance' the feature is replaced by the maintenance screen and its
--                   API returns 503.
--
--   Scheduling: starts_at / ends_at bound when a 'warning' or 'maintenance'
--   override is actually in force. Both are nullable:
--     starts_at null => active immediately.
--     ends_at   null => open-ended (no auto-clear).
--   The EFFECTIVE status is COMPUTED at read time (window-aware), never stored:
--     - status 'live'                 => effective 'live'.
--     - status 'warning'|'maintenance' => effective = that status ONLY IF
--         (starts_at is null OR now >= starts_at) AND
--         (ends_at   is null OR now <= ends_at);
--         otherwise effective 'live' (window not yet open, or already expired).
--   Expiry therefore AUTO-CLEARS with no cron: an expired row simply resolves
--   to 'live' on the next read. The same resolution runs identically in the
--   server helper (lib/feature-flags.ts) and is PRE-RESOLVED for clients by
--   the public /api/feature-flags route, so the browser never recomputes the
--   window. This table only ever stores the RAW row.
--
--   FAIL-OPEN remains the entire philosophy. A monitoring / maintenance system
--   must never be able to take the site down. If this table (or these new
--   columns) is unreadable for any reason, every caller treats every feature
--   as live. NO ROW FOR A KEY = LIVE.
--
--   Recovery surfaces (/admin/*, /login, /signup, /onboard*, /onboarding,
--   /settings*, the auth/account/quiz-core APIs, the Navbar, and the
--   feature-flag system itself) are NEVER gateable. That exclusion lives in
--   the app-side catalog (lib/features/catalog.ts) by construction; the admin
--   POST route rejects any key not in the catalog, and the catalog has no
--   nodes for those surfaces. The DB intentionally does not hard-code the
--   catalog so the app can evolve it without a migration.
--
--   security_alerts_sent is a small dedup ledger so the SOC alert cron
--   (/api/cron/security-alerts) emails support@ at most once per logical
--   event (per IP+hour for high-threat IPs, per minute for traffic spikes).
--
-- This migration references public.current_app_role() defined in migration
-- 057 (admin_console). It does NOT redefine it.
--
-- admin_audit_log action verb for this feature (free text; documented here):
--   feature_flag_change
--     metadata: { key, to: 'live'|'warning'|'maintenance',
--                 message, eta, startsAt, endsAt }
-- The alert cron writes to security_alerts_sent only; it produces NO audit
-- log rows (it is an automated, read-and-email job, not an admin action).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. feature_flags — widen the status CHECK to allow 'warning', and add the
--    scheduling window columns. The v1 CHECK was created inline and so was
--    auto-named by Postgres; drop it NAME-AGNOSTICALLY by locating whatever
--    CHECK constraint references the status column, then re-add a named one.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  v_conname text;
begin
  -- Find every CHECK constraint on public.feature_flags whose definition
  -- mentions the status column, and drop it regardless of its name. There is
  -- normally exactly one (the inline v1 status check).
  for v_conname in
    select c.conname
    from pg_constraint c
    join pg_class      t on t.oid = c.conrelid
    join pg_namespace  n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'feature_flags'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format(
      'alter table public.feature_flags drop constraint %I', v_conname);
  end loop;
end $$;

-- Re-add the widened status check under a stable, explicit name so future
-- migrations can drop it by name if needed.
alter table public.feature_flags
  drop constraint if exists feature_flags_status_check;
alter table public.feature_flags
  add constraint feature_flags_status_check
  check (status in ('live', 'warning', 'maintenance'));

-- Scheduling window. Nulls = open-ended (starts_at null => immediate,
-- ends_at null => never auto-clears). Effective status is computed from these
-- at read time; they are never used to mutate the stored row.
alter table public.feature_flags
  add column if not exists starts_at timestamptz;
alter table public.feature_flags
  add column if not exists ends_at   timestamptz;

comment on column public.feature_flags.starts_at is
  'Window start for a warning/maintenance override; null = active immediately. The effective status is computed from this at read time, never stored.';
comment on column public.feature_flags.ends_at is
  'Window end for a warning/maintenance override; null = open-ended. Past ends_at the row auto-resolves to live on the next read (no cron needed).';

comment on table public.feature_flags is
  'Admin kill-switch / maintenance overrides, one row per feature key. NO ROW = LIVE (safe default). status in (live, warning, maintenance); warning = usable + banner, maintenance = 503. starts_at/ends_at bound the override; effective status is computed window-aware at read time, never stored. Read by the service role only; anon is revoked. Fail-open: unreadable => treat everything as live.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. security_alerts_sent — dedup ledger for the SOC alert cron.
--    One row per logical alert already emailed. The cron checks for the
--    dedup_key before sending, then inserts it after a successful send, so a
--    given high-threat-IP-hour or traffic-spike-minute is emailed at most
--    once. The PRIMARY KEY is the only index this table needs.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.security_alerts_sent (
  dedup_key  text primary key,
  created_at timestamptz not null default now()
);

comment on table public.security_alerts_sent is
  'Dedup ledger for the SOC security-alert cron. One row per already-emailed alert (dedup_key e.g. threat:<ip>:<UTC date+hour> or spike:<minuteISO>). Read/written by the service role; anon revoked; admin can SELECT.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS — admin-only SELECT; every write path holds the service role
--    (BYPASSRLS), matching request_telemetry_rollup / security_events.
--    anon fully revoked. authenticated gets only SELECT, still gated by the
--    admin-only policy.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.security_alerts_sent enable row level security;

drop policy if exists security_alerts_sent_admin_select on public.security_alerts_sent;
create policy security_alerts_sent_admin_select on public.security_alerts_sent
  for select using (public.current_app_role() = 'admin');

revoke all on public.security_alerts_sent from anon;

-- authenticated gets only SELECT, still gated by the admin-only policy above.
grant select on public.security_alerts_sent to authenticated;
