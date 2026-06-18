import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { getShopItem } from "@/lib/shop-catalog";

// GET — fetch active boosters for the authenticated user
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: boosters, error } = await supabaseAdmin
    .from("active_boosters")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.warn("[shop/activate-booster GET]", error.message);
    return NextResponse.json({ boosters: [] });
  }

  const active = (boosters ?? [])
    .filter((b: Record<string, unknown>) => ((b.uses_remaining as number) ?? 0) > 0)
    .map((b: Record<string, unknown>) => ({
      id: b.id,
      item_id: b.item_id,
      // Live column is boost_type/boost_value; we expose it to clients under
      // the booster_effect/booster_value keys the web + iOS quizzes consume.
      booster_effect: b.boost_type ?? b.booster_effect ?? b.effect ?? "",
      booster_value: b.boost_value ?? b.booster_value ?? b.value ?? 1,
      uses_remaining: b.uses_remaining ?? 0,
      activated_at: b.activated_at ?? b.created_at ?? null,
    }));

  return NextResponse.json({ boosters: active });
}

// POST — activate a booster from inventory
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { itemId } = await req.json();

    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }

    // Server-trusted catalog lookup — NEVER trust client booster effect/value
    const item = getShopItem(itemId);
    if (!item || item.type !== "booster" || !item.boosterEffect) {
      return NextResponse.json({ error: "Not a booster" }, { status: 400 });
    }
    // Mastery Hint Pack is NOT an activatable booster — it credits the
    // profiles.mastery_hints_remaining counter on purchase and is spent directly
    // in Mastery Mode (/api/mastery/sessions/[id]/hint). Reject it here so a user
    // can't burn the inventory item into a dead active_boosters row.
    if (item.boosterEffect === "mastery_hint") {
      return NextResponse.json(
        { error: "Hints are used directly in Mastery Mode" },
        { status: 400 },
      );
    }
    const boosterEffect = item.boosterEffect;
    const boosterValue = item.boosterValue ?? 1;
    // uses_remaining comes from the catalog's boosterDuration so multi-use
    // boosters (e.g. the Streak Shield 3-pack) grant the right number of uses.
    // Single-use boosters keep duration 1. Floor at 1 so a missing/0 duration
    // never yields a dead booster.
    const usesRemaining = Math.max(1, item.boosterDuration ?? 1);

    // 1. Check inventory
    const { data: invItem, error: invErr } = await supabaseAdmin
      .from("user_inventory")
      .select("id, quantity")
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .single();

    if (invErr || !invItem || invItem.quantity < 1) {
      return NextResponse.json({ error: "Booster not in inventory" }, { status: 400 });
    }

    // 2. Check if same effect already active
    const { data: existing } = await supabaseAdmin
      .from("active_boosters")
      .select("id")
      .eq("user_id", userId)
      .eq("boost_type", boosterEffect)
      .gt("uses_remaining", 0)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Same booster type already active" }, { status: 400 });
    }

    // 3. Decrement inventory
    const newQty = invItem.quantity - 1;
    if (newQty <= 0) {
      await supabaseAdmin.from("user_inventory").delete().eq("id", invItem.id);
    } else {
      await supabaseAdmin.from("user_inventory").update({ quantity: newQty }).eq("id", invItem.id);
    }

    // 4. Create active booster
    const { error: insertErr } = await supabaseAdmin.from("active_boosters").insert({
      user_id: userId,
      item_id: itemId,
      boost_type: boosterEffect,
      boost_value: boosterValue,
      uses_remaining: usesRemaining,
      activated_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.error("[shop/activate-booster POST] insert:", insertErr.message);
      return NextResponse.json({ error: "Failed to activate" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[shop/activate-booster POST]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — consume a booster (verify ownership)
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { boosterId } = await req.json();
    if (!boosterId) {
      return NextResponse.json({ error: "Missing boosterId" }, { status: 400 });
    }

    const { data: booster } = await supabaseAdmin
      .from("active_boosters")
      .select("id, user_id, uses_remaining")
      .eq("id", boosterId)
      .single();

    if (!booster || booster.user_id !== userId) {
      return NextResponse.json({ error: "Booster not found" }, { status: 404 });
    }

    const newUses = booster.uses_remaining - 1;
    if (newUses <= 0) {
      await supabaseAdmin.from("active_boosters").delete().eq("id", booster.id);
    } else {
      await supabaseAdmin.from("active_boosters").update({ uses_remaining: newUses }).eq("id", booster.id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[shop/activate-booster PATCH]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
