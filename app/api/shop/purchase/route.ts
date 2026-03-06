import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — fetch user inventory
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const { data: inventory, error } = await supabaseAdmin
    .from("user_inventory")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    // Table might not exist yet — return empty
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
  try {
    const { userId, itemId, itemType, price, quantity, itemName, rarity } = await req.json();

    if (!userId || !itemId || !price) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

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

    // 2. For cosmetics, check if already owned (no duplicate purchase)
    if (itemType !== "booster") {
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
      return NextResponse.json({ error: "Failed to deduct coins: " + deductErr.message }, { status: 500 });
    }

    // 4. Add to inventory (upsert for boosters to increment quantity)
    if (itemType === "booster") {
      const { data: existingBooster } = await supabaseAdmin
        .from("user_inventory")
        .select("id, quantity")
        .eq("user_id", userId)
        .eq("item_id", itemId)
        .maybeSingle();

      if (existingBooster) {
        await supabaseAdmin
          .from("user_inventory")
          .update({ quantity: existingBooster.quantity + (quantity ?? 1) })
          .eq("id", existingBooster.id);
      } else {
        const { error: insertErr } = await supabaseAdmin.from("user_inventory").insert({
          user_id: userId,
          item_id: itemId,
          item_type: itemType,
          quantity: quantity ?? 1,
          equipped: false,
          rarity,
        });
        if (insertErr) console.warn("[shop/purchase] inventory insert:", insertErr.message);
      }
    } else {
      const { error: insertErr } = await supabaseAdmin.from("user_inventory").insert({
        user_id: userId,
        item_id: itemId,
        item_type: itemType,
        quantity: 1,
        equipped: false,
        rarity,
      });
      if (insertErr) console.warn("[shop/purchase] inventory insert:", insertErr.message);
    }

    // 5. Log purchase in coin_transactions (non-fatal)
    try {
      await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: -price,
        type: "shop_purchase",
        description: `Purchased ${itemName ?? itemId}${quantity > 1 ? ` x${quantity}` : ""}`,
      });
    } catch { /* non-fatal */ }

    // 6. Log in purchase_history
    try {
      await supabaseAdmin.from("purchase_history").insert({
        user_id: userId,
        item_id: itemId,
        item_name: itemName,
        item_type: itemType,
        rarity,
        price,
        quantity: quantity ?? 1,
      });
    } catch {
      // purchase_history table might not exist yet — non-fatal
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[shop/purchase POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
