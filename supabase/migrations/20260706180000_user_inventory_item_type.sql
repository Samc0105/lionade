-- Migration: rebuild user_inventory to the shape the shop code expects
--
-- WHY: prod's user_inventory was an ancient scaffold that NEVER matched the
-- shop code: item_id was UUID with an FK to a uuid shop_items catalog, while
-- the entire live codebase (purchase/equip/owned routes, lib/shop-tables.sql
-- spec) uses TEXT item ids from the code-side catalog ("boost_time_warp",
-- "frame_golden_lion", ...) plus item_type/rarity columns that did not exist.
-- Consequence, verified live 2026-07-06: EVERY shop purchase ever attempted
-- on prod 500'd - the Fang debit succeeded, the inventory insert failed
-- (missing item_type column; had that existed, the uuid item_id coercion
-- would have failed next), and the route auto-refunded. The table has ZERO
-- rows, so this rebuild loses nothing.
--
-- Shape: per lib/shop-tables.sql minus the stale item_type CHECK enum (live
-- cosmetics include auras / name effects / username effects that postdate
-- it). item_id is TEXT with NO FK (the catalog lives in code). Preserves the
-- old table's good ideas: UNIQUE(user_id, item_id) (the purchase route's
-- select-then-insert/update stacking model), owner-read RLS, service-role
-- only writes (no INSERT/UPDATE/DELETE policies; routes use supabaseAdmin).

DROP TABLE IF EXISTS public.user_inventory;

CREATE TABLE public.user_inventory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  item_type    TEXT,
  rarity       TEXT,
  quantity     INTEGER NOT NULL DEFAULT 1,
  equipped     BOOLEAN NOT NULL DEFAULT FALSE,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id ON public.user_inventory(user_id);

ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_inventory_select_own" ON public.user_inventory;
CREATE POLICY "user_inventory_select_own" ON public.user_inventory
  FOR SELECT USING (auth.uid() = user_id);
