-- profiles.equipped_username_effect
--
-- WHY: Shop V2 (2026-06-03) shipped the 6 animated username effects
-- (name_fx_rainbow / fire / holographic / gold / glitch / galaxy) plus
-- their AnimatedUsername component wired into 8 visibility surfaces.
-- BUT the schema column to PERSIST which effect a user has equipped was
-- never added. The frontend agent left it as a "future" stub.
--
-- Result: paying users could buy effects in the shop but couldn't
-- equip them, and the cross-surface rendering only worked for the
-- logged-in user (via SWR fetch from cosmetics-owned), never for
-- OTHER users on leaderboard / social / party because the column to
-- join didn't exist.
--
-- This migration closes the loop: text column on profiles, indexed
-- nowhere (it's only read alongside other profile fields, never
-- queried in isolation), default NULL = "no effect equipped" = plain
-- username.

alter table profiles
  add column if not exists equipped_username_effect text;

-- Column-level revoke so only the service-role /api/me/equip route
-- can mutate. Direct client writes to profiles via supabase.from()
-- shouldn't be able to fake an equipped effect they don't own.
revoke update (equipped_username_effect) on profiles from authenticated, anon;
