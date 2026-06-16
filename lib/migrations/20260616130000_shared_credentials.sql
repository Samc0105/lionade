-- 20260616130000_shared_credentials.sql
-- Admin credential vault for the /admin console. Stores shared team secrets
-- (third-party logins, API tokens, infra passwords) at rest under AES-256-GCM.
-- Web-only admin feature. RUN MANUALLY (Sam). No app code depends on this until
-- the /admin/vault routes ship.
--
-- THREAT MODEL (the portfolio point of this table):
--   Every secret is sealed by lib/vault/crypto.ts with a key that lives ONLY in
--   the server environment (CREDENTIAL_ENCRYPTION_KEY), NEVER in this database.
--   This table holds only ciphertext, a per-row random IV, and the GCM auth tag.
--   So even a full DB compromise (leaked dump, stolen backup, or an admin
--   reading rows directly through RLS) yields nothing but ciphertext. The
--   plaintext requires the env key, which is not in the DB. Decryption happens
--   exclusively inside a running server process that holds the key.
--
--   username/url/notes are NON-secret display/search fields and are stored as
--   plaintext on purpose; the secret itself is ONLY in secret_ciphertext.
--
-- DEPENDS ON (does NOT redefine):
--   * public.profiles                 (FK targets for created_by / updated_by)
--   * public.current_app_role()       (defined in 057_admin_console.sql; used in RLS)
--   * public.admin_audit_log + its append-only immutability trigger
--     (defined in 20260616121503_team_management.sql) which automatically
--     protects this feature's audit rows too.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. shared_credentials — one row per stored secret.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.shared_credentials (
  id                 uuid primary key default gen_random_uuid(),
  label              text not null,                  -- human-readable name, e.g. "Stripe dashboard"
  category           text,                           -- free text, nullable: social / email / infra / ...
  username           text,                           -- NON-secret: the login email/handle, for display+search
  url                text,                           -- NON-secret: where the credential is used
  notes              text,                           -- NON-secret notes (do not put the secret here)
  -- The sealed secret. AES-256-GCM output, all base64. The key is NOT in the DB.
  secret_ciphertext  text not null,
  secret_iv          text not null,
  secret_auth_tag    text not null,
  -- SET NULL (not CASCADE) so deleting a staff profile never erases vault rows.
  created_by         uuid references public.profiles(id) on delete set null,
  updated_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists shared_credentials_category_idx on public.shared_credentials (category);
create index if not exists shared_credentials_label_idx    on public.shared_credentials (label);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.shared_credentials_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_shared_credentials_updated_at on public.shared_credentials;
create trigger trg_shared_credentials_updated_at
  before update on public.shared_credentials
  for each row execute function public.shared_credentials_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS — admin-only for ALL operations. Even admins reading rows directly
--    through this policy get only ciphertext; the plaintext requires the env
--    key, which is not in the database. service_role (BYPASSRLS) is used by the
--    privileged /api/admin/vault routes.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.shared_credentials enable row level security;

create policy shared_credentials_admin_all on public.shared_credentials
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

revoke all on public.shared_credentials from anon;            -- never reachable unauthenticated
grant select, insert, update, delete on public.shared_credentials to authenticated; -- gated by RLS above

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Audit. admin_audit_log.action is free text (not CHECK-constrained) and is
--    already append-only via trg_admin_audit_log_immutable, so vault audit rows
--    are protected automatically — no new constraint or trigger is needed here.
--    New action verbs used by the vault feature:
--      vault_create, vault_update, vault_delete, vault_reveal
--    NOTE: never write any decrypted secret value into admin_audit_log.metadata.
-- ─────────────────────────────────────────────────────────────────────────
comment on column public.admin_audit_log.action is
  'Admin action type (free text). Team values: team_provision, team_offboard, team_role_change, team_password_reset, team_offboard_hard. Vault values: vault_create, vault_update, vault_delete, vault_reveal.';
