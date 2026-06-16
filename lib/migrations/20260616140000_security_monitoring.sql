-- 20260616140000_security_monitoring.sql
-- ============================================================
-- Security monitoring telemetry for the /admin security console.
-- WEB-ONLY admin feature. RUN MANUALLY (Sam) via the Supabase SQL editor.
-- No app code is allowed to apply this; the routes that read these tables
-- ship separately and tolerate the tables being absent until this is run.
-- Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY this migration exists / what each object is for:
--
--   1. request_telemetry_rollup
--        A LOW-cardinality, IP-FREE aggregate of every request the edge
--        middleware sees, bucketed to the minute. Dimensions are only
--        (bucket_minute x key_prefix x decision), so the row count is bounded
--        by minutes-elapsed x ~45 rate-limit key prefixes x 3 decisions. This
--        is what powers the live traffic chart on the admin overview. It must
--        NEVER hold a per-IP row: per-IP belongs in security_events (bounded)
--        or ip_denylist (tiny), not in this table.
--
--   2. security_events
--        Bounded per-IP threat signal. Middleware only emits the top-N
--        offenders per flush window plus discrete probe hits (scanner /
--        enumeration / admin_probe / denylist_hit), and the node route
--        handlers emit auth_failure rows. This is NOT a per-request log; it is
--        an offender ledger, so volume stays small.
--
--   3. ip_denylist
--        The admin-curated block list the edge middleware reads on a TTL.
--        Tiny by definition (one row per blocked IP).
--
--   4. ingest_telemetry_rollup(p_rows jsonb)
--        SECURITY DEFINER RPC that performs an ATOMIC per-bucket increment
--        upsert. PostgREST's own upsert overwrites the conflicting row, which
--        would lose concurrent flushes; this RPC adds the incoming count to
--        the stored count instead. That is the entire reason it exists.
--
-- This migration references public.current_app_role() defined in migration
-- 057 (admin_console). It does NOT redefine it.
--
-- New admin_audit_log action verbs introduced by the security console:
--   security_ip_block, security_ip_unblock
-- (admin_audit_log.action is free text; documented here, not constrained.)

-- ─────────────────────────────────────────────────────────────────────────
-- 1. request_telemetry_rollup — IP-free, minute-bucketed traffic aggregate.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.request_telemetry_rollup (
  id            bigserial primary key,
  bucket_minute timestamptz not null,
  key_prefix    text not null default 'unmatched',
  decision      text not null check (decision in ('allow', 'block', 'denylist')),
  count         integer not null default 0,
  constraint request_telemetry_rollup_unique unique (bucket_minute, key_prefix, decision)
);

create index if not exists request_telemetry_rollup_bucket_idx
  on public.request_telemetry_rollup (bucket_minute desc);

comment on table public.request_telemetry_rollup is
  'IP-free minute-bucketed request aggregate (bucket_minute x key_prefix x decision). Powers the admin overview traffic chart. NEVER store per-IP rows here.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. security_events — bounded per-IP offender ledger.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.security_events (
  id          bigserial primary key,
  ip          text not null,
  category    text not null check (category in (
                'scanner', 'bruteforce', 'enumeration', 'bot',
                'flood', 'denylist_hit', 'auth_failure', 'admin_probe')),
  severity    smallint not null default 1,
  path        text,
  method      text,
  user_agent  text,
  detail      jsonb not null default '{}'::jsonb,
  count       integer not null default 1,
  observed_at timestamptz not null default now()
);

create index if not exists security_events_observed_idx
  on public.security_events (observed_at desc);
create index if not exists security_events_ip_idx
  on public.security_events (ip);

comment on table public.security_events is
  'Bounded per-IP threat signal: middleware emits only top-N offenders + discrete probe hits, route handlers emit auth failures. NOT a per-request log.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ip_denylist — admin-curated block list, read by the edge on a TTL.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ip_denylist (
  ip         text primary key,
  reason     text,
  -- Nullable + SET NULL so deleting the blocking admin's profile never fails
  -- and never erases the block itself.
  blocked_by uuid references public.profiles(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists ip_denylist_active_idx
  on public.ip_denylist (active);

comment on table public.ip_denylist is
  'Admin-curated IP block list. The edge middleware reads active, non-expired rows on a TTL via the internal denylist route.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ingest_telemetry_rollup(p_rows jsonb) — ATOMIC increment upsert.
--    Each element of p_rows is {bucket_minute, key_prefix, decision, count}.
--    ON CONFLICT adds the incoming count to the stored count (PostgREST's
--    own upsert would overwrite and lose concurrent flushes).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.ingest_telemetry_rollup(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.request_telemetry_rollup (bucket_minute, key_prefix, decision, count)
  select
    (r->>'bucket_minute')::timestamptz,
    coalesce(nullif(r->>'key_prefix', ''), 'unmatched'),
    r->>'decision',
    coalesce((r->>'count')::integer, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  where r->>'decision' in ('allow', 'block', 'denylist')
  on conflict (bucket_minute, key_prefix, decision)
  do update set count = request_telemetry_rollup.count + excluded.count;
end;
$$;

revoke all on function public.ingest_telemetry_rollup(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_rollup(jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RLS — admin-only SELECT on all three tables; anon fully revoked;
--    service_role bypasses RLS (BYPASSRLS) for the privileged writes from
--    the node-runtime internal/admin routes. No INSERT/UPDATE/DELETE client
--    policies: every write path holds the service role.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.request_telemetry_rollup enable row level security;
alter table public.security_events           enable row level security;
alter table public.ip_denylist               enable row level security;

drop policy if exists request_telemetry_rollup_admin_select on public.request_telemetry_rollup;
create policy request_telemetry_rollup_admin_select on public.request_telemetry_rollup
  for select using (public.current_app_role() = 'admin');

drop policy if exists security_events_admin_select on public.security_events;
create policy security_events_admin_select on public.security_events
  for select using (public.current_app_role() = 'admin');

drop policy if exists ip_denylist_admin_select on public.ip_denylist;
create policy ip_denylist_admin_select on public.ip_denylist
  for select using (public.current_app_role() = 'admin');

revoke all on public.request_telemetry_rollup from anon;
revoke all on public.security_events           from anon;
revoke all on public.ip_denylist               from anon;

-- authenticated gets only SELECT, still gated by the admin-only policies above.
grant select on public.request_telemetry_rollup to authenticated;
grant select on public.security_events           to authenticated;
grant select on public.ip_denylist               to authenticated;
