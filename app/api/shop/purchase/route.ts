import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { getShopItem } from "@/lib/shop-catalog";

// GET — fetch user inventory
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: inventory, error } = await supabaseAdmin
    .from("user_inventory")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.warn("[shop/purchase GET] inventory fetch:", error.message);
    return NextResponse.json({ inventory: [] });
  }

  return NextResponse.json({
    inventory: (inventory ?? []).map((row: Record<string, unknown>) => ({
      itemId: row.item_id,
      quantity: row.quantity ?? 1,
      equipped: row.equipped ?? false,
      acquiredAt: row.created_at ?? row.acquired_at ?? null,
    })),
  });
}

// POST — purchase an item
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json();
    const { itemId } = body;
    const requestedQuantity = Math.max(1, Math.min(10, Number(body.quantity) || 1));

    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }

    // Server-trusted catalog lookup — NEVER trust client price/type
    const item = getShopItem(itemId);
    if (!item) {
      return NextResponse.json({ error: "Unknown item" }, { status: 404 });
    }

    const isBooster = item.type === "booster";
    const quantity = isBooster ? requestedQuantity : 1;
    const price = item.price * quantity;

    // 1. Check user has enough coins
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (profile.coins < price) {
      return NextResponse.json({ error: "Not enough coins" }, { status: 400 });
    }

    // 2. For cosmetics, check if already owned
    if (!isBooster) {
      const { data: existing } = await supabaseAdmin
        .from("user_inventory")
        .select("id")
        .eq("user_id", userId)
        .eq("item_id", itemId)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ error: "Already owned" }, { status: 400 });
      }
    }

    // 3. Deduct coins
    const { error: deductErr } = await supabaseAdmin
      .from("profiles")
      .update({ coins: profile.coins - price })
      .eq("id", userId);

    if (deductErr) {
      console.error("[shop/purchase] deduct:", deductErr.message);
      return NextResponse.json({ error: "Purchase failed" }, { status: 500 });
    }

    // 4. Add to inventory
    if (isBooster) {
      const { data: existingBooster } = await supabaseAdmin
        .from("user_inventory")
        .select("id, quantity")
        .eq("user_id", userId)
        .eq("item_id", itemId)
        .maybeSingle();

      if (existingBooster) {
        await supabaseAdmin
          .from("user_inventory")
          .update({ quantity: existingBooster.quantity + quantity })
          .eq("id", existingBooster.id);
      } else {
        const { error: insertErr } = await supabaseAdmin.from("user_inventory").insert({
          user_id: userId,
          item_id: itemId,
          item_type: item.type,
          quantity,
          equipped: false,
          rarity: item.rarity,
        });
        if (insertErr) console.warn("[shop/purchase] inventory insert:", insertErr.message);
      }
    } else {
      const { error: insertErr } = await supabaseAdmin.from("user_inventory").insert({
        user_id: userId,
        item_id: itemId,
        item_type: item.type,
        quantity: 1,
        equipped: false,
        rarity: item.rarity,
      });
      if (insertErr) console.warn("[shop/purchase] inventory insert:", insertErr.message);
    }

    // 5. Coin transaction log
    try {
      await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: -price,
        type: "shop_purchase",
        description: `Purchased ${item.name}${quantity > 1 ? ` x${quantity}` : ""}`,
      });
    } catch { /* non-fatal */ }

    // 6. Purchase history
    try {
      await supabaseAdmin.from("purchase_history").insert({
        user_id: userId,
        item_id: itemId,
        item_name: item.name,
        item_type: item.type,
        rarity: item.rarity,
        price,
        quantity,
      });
    } catch { /* purchase_history may not exist yet */ }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[shop/purchase POST]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
