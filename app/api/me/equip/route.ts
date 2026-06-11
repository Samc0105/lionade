/**
 * POST /api/me/equip
 *
 * Equip a cosmetic the user owns. Slot-based: each cosmetic type occupies
 * one slot at a time (one username_effect, one banner, one frame, etc).
 * Equipping a new cosmetic in a slot unequips whatever was there.
 *
 * Body: { slot: 'username_effect' | 'banner' | 'frame' | 'background' |
 *         'name_color' | 'avatar_aura' | 'voice_skin',
 *         cosmetic_id: string }
 *
 * Auth: requireAuth. Ownership: verifies the user actually owns the
 * cosmetic via user_inventory + earned_cosmetics + founder_grants.
 * Demo user: blocked from equip (would let the publicly-known demo
 * account get re-styled by anyone).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";

const VALID_SLOTS = [
  "username_effect",
  "banner",
  "animated_banner",
  "frame",
  "background",
  "name_color",
  "avatar_aura",
  "voice_skin",
] as const;
type Slot = (typeof VALID_SLOTS)[number];

// Migration 063: per-slot equipped pointers on profiles are the render
// source of truth (mirroring equipped_username_effect). Each slot below maps
// to a single nullable text column holding the equipped item id (null = none).
// Equipping writes the id; unequipping writes null. animated_banner shares
// the equipped_banner column with banner (a profile has one banner equipped).
const SLOT_COLUMN: Partial<Record<Slot, string>> = {
  username_effect: "equipped_username_effect",
  frame: "equipped_frame",
  name_color: "equipped_name_color",
  banner: "equipped_banner",
  animated_banner: "equipped_banner",
  avatar_aura: "equipped_avatar_aura",
};

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (isDemoUser(userId)) {
    return NextResponse.json(
      { error: "Demo accounts can't change cosmetics. Sign up to try it for real." },
      { status: 403 },
    );
  }

  let body: { slot?: unknown; cosmetic_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slot = typeof body.slot === "string" ? body.slot : "";
  // Bucket C 2026-06-05: empty string OR explicit null on cosmetic_id is now
  // a valid "unequip this slot" signal. Backed by the new Shop unequip CTA.
  const rawId = body.cosmetic_id;
  const cosmeticId =
    typeof rawId === "string" ? rawId :
    rawId === null ? "" :
    undefined;

  if (!VALID_SLOTS.includes(slot as Slot)) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }
  if (cosmeticId === undefined) {
    return NextResponse.json({ error: "Missing cosmetic_id" }, { status: 400 });
  }

  // ── Unequip path ──
  // Empty/null cosmetic_id clears the slot. Column-backed slots (migration
  // 063) write null to the matching profiles.equipped_<slot> column — that
  // column is the render source of truth. We also clear any stale
  // user_inventory.equipped bookkeeping for the matching item_type.
  if (!cosmeticId) {
    const column = SLOT_COLUMN[slot as Slot];
    if (column) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ [column]: null })
        .eq("id", userId);
      if (error) {
        console.error(`[me/equip] ${slot} unequip:`, error.message);
        return NextResponse.json({ error: "Failed to unequip" }, { status: 500 });
      }
    }
    // Clear `equipped=true` rows of this item_type for inventory bookkeeping.
    // banner/animated_banner both clear their own item_type rows; the single
    // equipped_banner column already enforces one-banner-equipped.
    const itemType = slot === "animated_banner" ? "animated_banner"
                   : slot === "banner"          ? "banner"
                   : slot === "frame"           ? "frame"
                   : slot === "background"      ? "background"
                   : slot === "name_color"      ? "name_color"
                   : slot === "avatar_aura"     ? "avatar_aura"
                   : null;
    if (itemType) {
      await supabaseAdmin
        .from("user_inventory")
        .update({ equipped: false })
        .eq("user_id", userId)
        .eq("item_type", itemType);
    }
    return NextResponse.json({ ok: true, slot, cosmetic_id: null });
  }

  // Ownership check — cosmetic must exist in one of: user_inventory,
  // earned_cosmetics, founder_grants. Single OR query against all three
  // sources so the user can equip purchased / earned / founder items.
  const [inv, earned, founder] = await Promise.all([
    supabaseAdmin
      .from("user_inventory")
      .select("id")
      .eq("user_id", userId)
      .eq("item_id", cosmeticId)
      .maybeSingle(),
    supabaseAdmin
      .from("earned_cosmetics")
      .select("id")
      .eq("user_id", userId)
      .eq("cosmetic_id", cosmeticId)
      .maybeSingle(),
    supabaseAdmin
      .from("founder_grants")
      .select("id")
      .eq("user_id", userId)
      .eq("badge_id", cosmeticId)
      .maybeSingle(),
  ]);

  const owned = Boolean(inv.data ?? earned.data ?? founder.data);
  if (!owned) {
    return NextResponse.json(
      { error: "You don't own this cosmetic" },
      { status: 403 },
    );
  }

  // Column-backed slots (migration 063): write the equipped item id to the
  // matching profiles.equipped_<slot> column — the single render source of
  // truth. Writing one id implicitly unequips any prior item in that slot
  // (the column holds a single id). We ALSO keep user_inventory.equipped
  // bookkeeping in sync for any legacy reader.
  const column = SLOT_COLUMN[slot as Slot];
  if (column) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ [column]: cosmeticId })
      .eq("id", userId);
    if (error) {
      console.error(`[me/equip] ${slot} update:`, error.message);
      return NextResponse.json({ error: "Failed to equip" }, { status: 500 });
    }
  }

  // Inventory bookkeeping — unequip other items of the same type, equip this
  // one. Earned + founder cosmetics aren't tracked in user_inventory so this
  // is a no-op for them; their render state comes from the profiles column.
  if (inv.data) {
    const { data: catalogItem } = await supabaseAdmin
      .from("user_inventory")
      .select("item_type")
      .eq("user_id", userId)
      .eq("item_id", cosmeticId)
      .single();
    const itemType = catalogItem?.item_type ?? null;

    if (itemType) {
      await supabaseAdmin
        .from("user_inventory")
        .update({ equipped: false })
        .eq("user_id", userId)
        .eq("item_type", itemType)
        .neq("item_id", cosmeticId);
    }
    await supabaseAdmin
      .from("user_inventory")
      .update({ equipped: true })
      .eq("user_id", userId)
      .eq("item_id", cosmeticId);
  }

  return NextResponse.json({ ok: true, slot, cosmetic_id: cosmeticId });
}
