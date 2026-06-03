import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  getShopItem,
  getFounderBadge,
  isEarnedCosmeticId,
} from "@/lib/shop-catalog";
import { isFounderCapOpen } from "@/lib/cosmetic-grants";

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

    // Shop V2 — earned cosmetics are NEVER purchasable. Reject early before
    // any DB work. The catalog has both exact-match and dynamic-prefix
    // (mastery medals) so isEarnedCosmeticId handles both.
    if (isEarnedCosmeticId(itemId)) {
      return NextResponse.json(
        { error: "This item can only be earned, not purchased" },
        { status: 400 },
      );
    }

    // Shop V2 — founder badges have their own purchase path: paid bundles
    // go through Stripe IAP (handled in a separate route), but if a Fang
    // purchase ever lands here we still need to enforce the cap + insert
    // into founder_grants (NOT user_inventory).
    //
    // For the current V2 catalog only `badge_founding_scholar` is
    // purchasable, and it's $14.99 Stripe-only. We still handle the
    // generic founder-badge case here so future Fang-priced founder badges
    // get the same cap + grant-table treatment without route surgery.
    const founder = getFounderBadge(itemId);
    if (founder) {
      if (!founder.purchasable) {
        return NextResponse.json(
          { error: "This badge is not for sale" },
          { status: 400 },
        );
      }
      // Stripe-priced founder badges should not be bought via this Fangs
      // route — surface that explicitly rather than silently 404ing later.
      if (founder.priceUSD !== undefined) {
        return NextResponse.json(
          { error: "This founder badge is sold as a Stripe bundle, not Fangs" },
          { status: 400 },
        );
      }
      return handleFounderBadgePurchase(userId, founder.id, founder.cap, founder.name);
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
      p_source: "spend",
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
        p_source: "cashable",
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

/**
 * Founder badge purchase flow — Fangs-priced variant.
 *
 * The current V2 catalog only ships `badge_founding_scholar` and it's a
 * Stripe $14.99 bundle, so this Fangs path is reserved for future founder
 * badges. The flow:
 *   1. Check `is_founder_cap_open(id, cap)` — race-safe RPC. Returns false
 *      if the cap is full OR on any error (defensive).
 *   2. Reject if already owned (founder grants are one per user).
 *   3. Insert into `founder_grants` (NOT user_inventory — founder badges
 *      live in their own table for analytics + capped-grant integrity).
 *
 * NOTE: this helper does NOT debit Fangs because no founder badge is
 * currently priced in Fangs. When Sam adds one, this helper must take a
 * price parameter and call `update_user_coins(-price, source='spend')`
 * with the same refund-on-failure pattern the cosmetic path uses.
 */
async function handleFounderBadgePurchase(
  userId: string,
  badgeId: string,
  cap: number,
  displayName: string,
): Promise<NextResponse> {
  const capOpen = await isFounderCapOpen(supabaseAdmin, badgeId, cap);
  if (!capOpen) {
    return NextResponse.json(
      { error: "This founder badge is sold out" },
      { status: 409 },
    );
  }

  // Idempotency / already-owned check. The founder_grants table has a
  // UNIQUE (user_id, badge_id) — we still pre-check so the error message
  // is friendly instead of a 23505 leak.
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("founder_grants")
    .select("user_id")
    .eq("user_id", userId)
    .eq("badge_id", badgeId)
    .maybeSingle();
  if (existingErr) {
    console.error("[shop/purchase founder-check]", existingErr.message);
    return NextResponse.json({ error: "Purchase failed" }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ error: "Already owned" }, { status: 400 });
  }

  const { error: grantErr } = await supabaseAdmin.from("founder_grants").insert({
    user_id: userId,
    badge_id: badgeId,
    source: "purchase",
  });
  if (grantErr) {
    // Race: another request snuck in between cap-check and insert and
    // either tripped the unique constraint OR the cap row. 23505 means
    // already-owned; anything else is a generic failure.
    if (grantErr.code === "23505") {
      return NextResponse.json({ error: "Already owned" }, { status: 400 });
    }
    console.error("[shop/purchase founder-grant]", grantErr.message);
    return NextResponse.json({ error: "Purchase failed" }, { status: 500 });
  }

  try {
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: 0,
      type: "founder_badge_grant",
      description: `Granted founder badge: ${displayName}`,
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ success: true, source: "founder" });
}
