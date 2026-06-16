-- 20260616170000_status_incidents_health.sql
-- ============================================================
-- Status / Incidents / Health: WEB-ONLY tables that turn the kill-switch v2
-- (20260616160000_feature_flags_v2.sql) into a self-observing system with a
-- public /status page and an auto-maintenance evaluator.
-- RUN MANUALLY (Sam) via the Supabase SQL editor. No app code applies this;
-- the routes that read/write these objects ship separately and tolerate them
-- being absent (a missing column / table => "no signal" => everything live).
-- Fully idempotent; safe to re-run. Sorts AFTER 20260616160000.
-- ============================================================
--
-- WHY this migration exists / how it is meant to be used:
--
--   Kill-switch v2 gave admins three manual states (live / warning /
--   maintenance) with a scheduling window. This migration adds the machinery
--   to (a) observe feature health, (b) AUTO-flag a struggling feature into
--   'warning' WITHOUT a human, and (c) surface all of it on a public status
--   page.
--
--   1. feature_flags.auto (new boolean column)
--      ------------------------------------------------------------------
--      Records WHO last wrote the row:
--        auto = false  a human set this row (manual admin change). This is a
--                      human override and the auto-maintenance evaluator must
--                      NEVER touch it.
--        auto = true   the auto-maintenance evaluator set this row.
--      Default false so every pre-existing / manually-created row is treated
--      as a human override and is left alone. The evaluator only ever:
--        - promotes a 'live' row (or an existing auto=true 'warning' row) to
--          'warning', and
--        - recovers its OWN auto=true 'warning' rows back to 'live'.
--      It NEVER sets 'maintenance' (that stays a deliberate human action) and
--      it NEVER overwrites an auto=false warning/maintenance row.
--
--   2. incidents
--      ------------------------------------------------------------------
--      An append-mostly timeline that MIRRORS the flag history so the public
--      /status page can show "recent history". One open row (ended_at null)
--      per feature_key while it is degraded; closed (ended_at set) when the
--      feature returns to live. Both manual changes (admin POST) and the auto
--      evaluator open/close these. kind in (warning, maintenance) records what
--      the feature was degraded INTO; source in (manual, auto) records who.
--      The partial index on (feature_key) WHERE ended_at is null keeps the
--      "is there an open incident?" idempotency check on openIncident cheap.
--
--   3. feature_health_events
--      ------------------------------------------------------------------
--      A bounded firehose: one row each time a guarded route is about to
--      return a 5xx for a feature (recorded fire-and-forget by
--      recordFeatureError, NEVER blocking the request). The evaluator reads
--      only a short trailing window (last ~10 min) grouped per feature_key, so
--      the (feature_key, observed_at desc) index serves the only query. Only
--      5xx are recorded; 4xx/validation are not. A future cleanup job can
--      prune rows older than the evaluator window; nothing here depends on
--      old rows.
--
--   FAIL-OPEN remains the entire philosophy. NOTHING here may take the site
--   down or block a request path:
--     - recordFeatureError is fire-and-forget; it reads nothing and swallows
--       all errors.
--     - The auto evaluator sets ONLY 'warning' (usable + banner), NEVER
--       'maintenance'.
--     - Auto-flags self-expire via the v2 window (ends_at = now + 20 min), so
--       even if the evaluator stops running the feature returns to live on the
--       next read. No cron is required to recover.
--     - If any of these tables/columns is unreadable, every caller treats
--       every feature as live, exactly as for v1/v2.
--
--   The public /status page MUST ALWAYS be reachable, even under a 'site'
--   maintenance flag. That exemption lives in the app (MaintenanceGate exempts
--   /status and /status/*) and in the data path: /status reads through the
--   SERVICE ROLE only, NEVER anon. anon has no access to either new table.
--
-- This migration references public.current_app_role() defined in migration
-- 057 (admin_console). It does NOT redefine it.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. feature_flags.auto — provenance of the current row (human vs evaluator).
--    Default false => every existing row is a human override the evaluator
--    leaves alone. No backfill needed: the default is the safe value.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.feature_flags
  add column if not exists auto boolean not null default false;

comment on column public.feature_flags.auto is
  'true = this row was set by the auto-maintenance evaluator; false = a human set it. The evaluator NEVER touches an auto=false warning/maintenance row (a human override), and NEVER sets maintenance. Default false so every existing/manual row is treated as a human override.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. incidents — flag-history timeline for the public /status page.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.incidents (
  id          bigserial primary key,
  feature_key text not null,
  kind        text not null check (kind in ('warning', 'maintenance')),
  message     text,
  source      text not null default 'manual' check (source in ('manual', 'auto')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.incidents is
  'Append-mostly timeline mirroring feature_flags history, one OPEN row (ended_at null) per degraded feature_key. kind = degraded-into (warning|maintenance); source = manual|auto. Closed (ended_at set) when the feature returns to live. Read by the service role and admin; anon revoked. Powers the public /status recent-history list.';

-- Newest-first scan for the /status recent-history list.
create index if not exists incidents_started_at_idx
  on public.incidents (started_at desc);

-- Cheap "is there an open incident for this key?" check used by openIncident
-- idempotency; partial so it only indexes currently-open incidents.
create index if not exists incidents_open_by_feature_idx
  on public.incidents (feature_key)
  where ended_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. feature_health_events — bounded 5xx firehose the evaluator reads from.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.feature_health_events (
  id          bigserial primary key,
  feature_key text not null,
  observed_at timestamptz not null default now()
);

comment on table public.feature_health_events is
  'Bounded firehose: one row per about-to-be-5xx for a guarded feature, written fire-and-forget by recordFeatureError (never blocks the request). Only 5xx are recorded. The auto-maintenance evaluator reads only a short trailing window grouped per feature_key. A future cleanup may prune old rows. Read by the service role; anon revoked; admin SELECT.';

-- Serves the only query: per-feature_key count over a trailing time window.
create index if not exists feature_health_events_key_time_idx
  on public.feature_health_events (feature_key, observed_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS — admin-only SELECT via public.current_app_role() = 'admin'.
--    anon fully revoked; authenticated granted SELECT only (still gated by
--    the admin-only policy). The service role bypasses RLS (BYPASSRLS) for
--    the privileged public /status reads, recordFeatureError inserts, the
--    incident open/close writes, and the evaluator. Public /status reads go
--    through the service role, NEVER anon. Matches the pattern used by
--    security_alerts_sent / feature_flags.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.incidents enable row level security;

drop policy if exists incidents_admin_select on public.incidents;
create policy incidents_admin_select on public.incidents
  for select using (public.current_app_role() = 'admin');

revoke all on public.incidents from anon;
grant select on public.incidents to authenticated;

alter table public.feature_health_events enable row level security;

drop policy if exists feature_health_events_admin_select on public.feature_health_events;
create policy feature_health_events_admin_select on public.feature_health_events
  for select using (public.current_app_role() = 'admin');

revoke all on public.feature_health_events from anon;
grant select on public.feature_health_events to authenticated;
