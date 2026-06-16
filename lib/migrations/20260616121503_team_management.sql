-- 20260616121503_team_management.sql
-- Team management / IAM for the /admin console. Provision + offboard @getlionade.com
-- team members (optionally with a Lionade Supabase account) from one form.
-- Web-only admin feature. RUN MANUALLY (Sam). No app code depends on this until the
-- /admin/team routes ship.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. team_members — one row per (current or former) team member.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.team_members (
  id                   uuid primary key default gen_random_uuid(),
  -- Nullable: lionade_access='none' members have no Supabase account. SET NULL (not
  -- CASCADE) so deleting an auth user never erases the team/audit record.
  user_id              uuid references auth.users(id) on delete set null,
  full_name            text not null,
  -- becomes username@getlionade.com; enforced shape mirrors the app-layer regex.
  username             text not null unique
                         check (username ~ '^[a-z][a-z0-9.-]{2,30}$'),
  email_address        text not null unique,           -- username@getlionade.com
  personal_email       text not null,                  -- Cloudflare forward target
  cloudflare_address_id text,                           -- provider handle for revocation
  role                 text not null
                         check (role in ('founder','engineer','support','contractor','advisor','former_team')),
  lionade_access       text not null default 'none'
                         check (lionade_access in ('none','viewer','editor','admin')),
  status               text not null default 'pending'
                         check (status in ('active','suspended','offboarded','pending')),
  must_change_password boolean not null default true,
  invited_by           uuid references public.profiles(id) on delete set null,
  invited_at           timestamptz not null default now(),
  activated_at         timestamptz,
  offboarded_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists team_members_status_idx on public.team_members (status);
create index if not exists team_members_role_idx   on public.team_members (role);
create index if not exists team_members_user_id_idx on public.team_members (user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.team_members_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_team_members_updated_at on public.team_members;
create trigger trg_team_members_updated_at
  before update on public.team_members
  for each row execute function public.team_members_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS — admin full access; a team member may read only their own row;
--    service_role bypasses RLS (BYPASSRLS) for the privileged API ops.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.team_members enable row level security;

create policy team_members_admin_all on public.team_members
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy team_members_self_select on public.team_members
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.team_members from anon;          -- never reachable unauthenticated
grant select, insert, update, delete on public.team_members to authenticated; -- gated by RLS above

-- ─────────────────────────────────────────────────────────────────────────
-- 4. admin_audit_log immutability (portfolio control: append-only audit).
--    Blocks DELETE and blocks UPDATE of the *content* columns, while still
--    allowing the existing ON DELETE SET NULL FK cascade to null performed_by/
--    target_user_id (so GDPR profile deletion is NOT broken).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_admin_audit_log_immutable()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    raise exception 'admin_audit_log is append-only: DELETE is not permitted';
  end if;
  -- UPDATE: permit only the FK-cascade nulling of performed_by / target_user_id.
  if (new.id          is distinct from old.id
      or new.action   is distinct from old.action
      or new.metadata is distinct from old.metadata
      or new.created_at is distinct from old.created_at) then
    raise exception 'admin_audit_log is append-only: content columns are immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_admin_audit_log_immutable on public.admin_audit_log;
create trigger trg_admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function public.enforce_admin_audit_log_immutable();

-- New action values used by the team feature (action is free text — documented,
-- not constrained, so existing inserts with other action values keep working):
--   team_provision, team_offboard, team_role_change, team_password_reset, team_offboard_hard
comment on column public.admin_audit_log.action is
  'Admin action type (free text). Team values: team_provision, team_offboard, team_role_change, team_password_reset, team_offboard_hard.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. profiles.role gains 'former_team' (set on soft-offboard). Name-agnostic
--    drop/re-add so it survives whatever the existing CHECK is named.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.profiles'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%' and pg_get_constraintdef(oid) ilike '%admin%'
  limit 1;
  if c is not null then
    execute format('alter table public.profiles drop constraint %I', c);
  end if;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user','support','admin','former_team'));
