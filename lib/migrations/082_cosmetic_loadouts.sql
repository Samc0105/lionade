-- Migration 082: cosmetic loadout presets.
--
-- ⚠️ NOT YET APPLIED — Sam runs this manually (per the migration policy).
--
-- Lets a user save their whole look (the 5 cosmetic slots) as a named preset and
-- swap the entire set in one tap. A dedicated table (not a profiles JSONB column)
-- so we get a per-preset id for delete, can enforce a per-user cap, and don't
-- bloat the heavily-read profiles row.
--
-- Presets store cosmetic IDS ONLY and reference whatever the user MIGHT own.
-- Ownership is NOT validated on save (the catalog can change after a save); it
-- is validated on APPLY by /api/me/loadout (PATCH), which writes the protected
-- profiles.equipped_* columns via the service role. Therefore direct
-- authenticated CRUD on this table (scoped to the owner) is safe — there is no
-- ownership-fraud surface here, unlike the equipped_* columns.

create table if not exists public.cosmetic_loadouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  loadout_frame text,
  loadout_avatar_aura text,
  loadout_name_color text,
  loadout_banner text,
  loadout_username_effect text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cosmetic_loadouts_user_id_idx on public.cosmetic_loadouts(user_id);

alter table public.cosmetic_loadouts enable row level security;

-- Owner-scoped CRUD. (A per-user cap of 8 is enforced in the API layer.)
drop policy if exists "loadouts_select_own" on public.cosmetic_loadouts;
create policy "loadouts_select_own" on public.cosmetic_loadouts
  for select using (auth.uid() = user_id);

drop policy if exists "loadouts_insert_own" on public.cosmetic_loadouts;
create policy "loadouts_insert_own" on public.cosmetic_loadouts
  for insert with check (auth.uid() = user_id);

drop policy if exists "loadouts_update_own" on public.cosmetic_loadouts;
create policy "loadouts_update_own" on public.cosmetic_loadouts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "loadouts_delete_own" on public.cosmetic_loadouts;
create policy "loadouts_delete_own" on public.cosmetic_loadouts
  for delete using (auth.uid() = user_id);
