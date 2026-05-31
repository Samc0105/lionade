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

    // 1. For cosmetics, check if already owned BEFORE debiting
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

    // 2. Atomic debit — guard prevents double-spend race across parallel tabs.
    const { error: debitErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: -price,
      p_min_balance: 0,
    });

    if (debitErr) {
      if (debitErr.code === "P0001") {
        return NextResponse.json({ error: "Not enough coins" }, { status: 400 });
      }
      console.error("[shop/purchase] debit:", debitErr.message);
      return NextResponse.json({ error: "Purchase failed" }, { status: 500 });
    }

    // 3. Add to inventory — on failure, REFUND atomically and surface 500.
    // Previously this was best-effort with console.warn, so a user could pay
    // and receive nothing. Mirrors the refund pattern in place-bet.
    let inventoryErr: { message: string } | null = null;
    try {
      if (isBooster) {
        const { data: existingBooster } = await supabaseAdmin
          .from("user_inventory")
          .select("id, quantity")
          .eq("user_id", userId)
          .eq("item_id", itemId)
          .maybeSingle();

        if (existingBooster) {
          const { error: updErr } = await supabaseAdmin
            .from("user_inventory")
            .update({ quantity: existingBooster.quantity + quantity })
            .eq("id", existingBooster.id);
          if (updErr) inventoryErr = { message: updErr.message };
        } else {
          const { error: insErr } = await supabaseAdmin.from("user_inventory").insert({
            user_id: userId,
            item_id: itemId,
            item_type: item.type,
            quantity,
            equipped: false,
            rarity: item.rarity,
          });
          if (insErr) inventoryErr = { message: insErr.message };
        }
      } else {
        const { error: insErr } = await supabaseAdmin.from("user_inventory").insert({
          user_id: userId,
          item_id: itemId,
          item_type: item.type,
          quantity: 1,
          equipped: false,
          rarity: item.rarity,
        });
        if (insErr) inventoryErr = { message: insErr.message };
      }
    } catch (e) {
      inventoryErr = { message: e instanceof Error ? e.message : "inventory exception" };
    }

    if (inventoryErr) {
      console.error("[shop/purchase] inventory write failed, refunding:", inventoryErr.message);
      await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: price,
        p_min_balance: 0,
      });
      return NextResponse.json({ error: "Purchase failed, refunded" }, { status: 500 });
    }

    // 4. Coin transaction log
    try {
      await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: -price,
        type: "shop_purchase",
        description: `Purchased ${item.name}${quantity > 1 ? ` x${quantity}` : ""}`,
      });
    } catch { /* non-fatal */ }

    // 5. Purchase history
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
