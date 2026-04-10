import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

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

    // 3. Toggle this item
    const { error: updateErr } = await supabaseAdmin
      .from("user_inventory")
      .update({ equipped: nowEquipped })
      .eq("id", item.id);

    if (updateErr) {
      console.error("[shop/equip] update:", updateErr.message);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    return NextResponse.json({ success: true, equipped: nowEquipped });
  } catch (err) {
    console.error("[shop/equip POST]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
