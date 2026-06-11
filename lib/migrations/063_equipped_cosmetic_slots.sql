-- Migration 063: Per-slot equipped-cosmetic pointers on profiles.
--
-- ⚠️ NOT YET APPLIED — Sam runs this manually.
--
-- WHY: Shop cosmetics are bought + owned (user_inventory / earned / founder
-- grants) but, outside the username-effect slot, there was no cheap way to
-- render which cosmetic a user has EQUIPPED — especially for OTHER users on
-- the list endpoints (leaderboard / social / party). Those surfaces already
-- SELECT a batch of profiles columns per row and render them inline; making
-- them join user_inventory.equipped per row per slot would be N extra reads.
--
-- The precedent is profiles.equipped_username_effect (added
-- 2026-06-04 / supabase/migrations/20260604200000_equipped_username_effect.sql):
-- a single nullable text column holding the equipped item id, read alongside
-- the other profile fields the list endpoints already pull, default NULL =
-- "nothing equipped" = plain render. leaderboard/page.tsx, social/page.tsx
-- and the party renderers all consume that column directly off each row.
--
-- This migration extends that EXACT pattern to the remaining cosmetic slots so
-- purchased cosmetics actually render cross-surface, for self and for others,
-- with one extra column read instead of a per-row join.
--
-- Slots (all nullable text, store the cosmetic item id; NULL = none):
--   • equipped_frame        — avatar frame
--   • equipped_name_color   — username color
--   • equipped_banner       — profile banner (covers static banner_* AND
--                             animated_banner_* item ids in one column)
--   • equipped_avatar_aura  — avatar aura
--
-- DEFAULT: none. Each column defaults to NULL (no DEFAULT clause). An empty /
-- "none" state must not render any cosmetic and must not flash a placeholder —
-- exactly how equipped_username_effect's NULL means "plain username".
--
-- INDEXES: none. Mirroring equipped_username_effect, these are only ever read
-- alongside the rest of a profile row (never filtered/sorted on in isolation),
-- so no index is warranted.
--
-- RLS: no new policy needed. RLS on profiles is row-level for SELECT — the
-- existing profiles SELECT policy already exposes a profile row's columns to
-- other authenticated users (that is the only reason leaderboard/social/party
-- can read another user's equipped_username_effect today). New columns on that
-- same row inherit the identical SELECT exposure automatically. We DO mirror
-- the column-level UPDATE REVOKE below so clients can't fake an equip they
-- don't own; only the service-role /api/me/equip route mutates these.

alter table profiles
  add column if not exists equipped_frame       text;  -- item id of equipped avatar frame, null = none
alter table profiles
  add column if not exists equipped_name_color  text;  -- item id of equipped username color, null = none
alter table profiles
  add column if not exists equipped_banner       text; -- item id of equipped profile banner (static banner_* or animated_banner_*), null = none
alter table profiles
  add column if not exists equipped_avatar_aura  text;  -- item id of equipped avatar aura, null = none

-- Column-level UPDATE revoke (mirrors equipped_username_effect): only the
-- service-role /api/me/equip route may set these. Direct client writes to
-- profiles via supabase.from() must not be able to fake an equipped cosmetic
-- the user doesn't own. service_role is unaffected by REVOKE.
revoke update (equipped_frame)       on profiles from authenticated, anon;
revoke update (equipped_name_color)  on profiles from authenticated, anon;
revoke update (equipped_banner)      on profiles from authenticated, anon;
revoke update (equipped_avatar_aura) on profiles from authenticated, anon;
