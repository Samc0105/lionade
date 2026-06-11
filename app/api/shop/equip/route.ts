import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

// Migration 063: per-slot equipped pointers on profiles are the render source
// of truth. Map an inventory item_type to its profiles column so equipping a
// generic cosmetic (frame/banner/aura/name color) actually renders. A profile
// holds one banner, so static banner and animated_banner share equipped_banner.
const TYPE_COLUMN: Record<string, string> = {
  frame: "equipped_frame",
  name_color: "equipped_name_color",
  banner: "equipped_banner",
  animated_banner: "equipped_banner",
  avatar_aura: "equipped_avatar_aura",
  username_effect: "equipped_username_effect",
};

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { itemId } = await req.json();

    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }

    // 1. Get the item being toggled
    const { data: item, error: itemErr } = await supabaseAdmin
      .from("user_inventory")
      .select("id, item_id, item_type, equipped")
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .single();

    if (itemErr || !item) {
      return NextResponse.json({ error: "Item not found in inventory" }, { status: 404 });
    }

    // Don't allow equipping boosters
    if (item.item_type === "booster") {
      return NextResponse.json({ error: "Boosters cannot be equipped" }, { status: 400 });
    }

    const nowEquipped = !item.equipped;

    // 2. If equipping, unequip any other item of the same type first
    if (nowEquipped) {
      await supabaseAdmin
        .from("user_inventory")
        .update({ equipped: false })
        .eq("user_id", userId)
        .eq("item_type", item.item_type)
        .neq("item_id", itemId);
    }

    // 3. Toggle this item in inventory bookkeeping
    const { error: updateErr } = await supabaseAdmin
      .from("user_inventory")
      .update({ equipped: nowEquipped })
      .eq("id", item.id);

    if (updateErr) {
      console.error("[shop/equip] update:", updateErr.message);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    // 4. Write the render source of truth — profiles.equipped_<slot> (migration
    // 063). Equip writes this item id (implicitly unequipping any prior item in
    // the slot); unequip writes null. Ownership is already proven above (the
    // item came from this user's user_inventory). Without this the cosmetic
    // never renders for the buyer or for other users on list/party surfaces.
    const column = TYPE_COLUMN[item.item_type as string];
    if (column) {
      const { error: profileErr } = await supabaseAdmin
        .from("profiles")
        .update({ [column]: nowEquipped ? itemId : null })
        .eq("id", userId);
      if (profileErr) {
        console.error("[shop/equip] profile equip column:", profileErr.message);
        return NextResponse.json({ error: "Failed to update" }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, equipped: nowEquipped });
  } catch (err) {
    console.error("[shop/equip POST]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
