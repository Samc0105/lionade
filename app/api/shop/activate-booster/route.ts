import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — fetch active boosters for a user
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const { data: boosters, error } = await supabaseAdmin
    .from("active_boosters")
    .select("id, item_id, booster_effect, booster_value, uses_remaining, activated_at")
    .eq("user_id", userId)
    .gt("uses_remaining", 0);

  if (error) {
    // Table might not exist yet
    console.warn("[shop/activate-booster GET]", error.message);
    return NextResponse.json({ boosters: [] });
  }

  return NextResponse.json({ boosters: boosters ?? [] });
}

// POST — activate a booster from inventory
export async function POST(req: NextRequest) {
  try {
    const { userId, itemId, boosterEffect, boosterValue } = await req.json();

    if (!userId || !itemId || !boosterEffect) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Check inventory — must own at least 1
    const { data: invItem, error: invErr } = await supabaseAdmin
      .from("user_inventory")
      .select("id, quantity")
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .single();

    if (invErr || !invItem || invItem.quantity < 1) {
      return NextResponse.json({ error: "Booster not in inventory" }, { status: 400 });
    }

    // 2. Check if same booster type is already active
    const { data: existing } = await supabaseAdmin
      .from("active_boosters")
      .select("id")
      .eq("user_id", userId)
      .eq("booster_effect", boosterEffect)
      .gt("uses_remaining", 0)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Same booster type already active" }, { status: 400 });
    }

    // 3. Decrement inventory quantity
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
      booster_effect: boosterEffect,
      booster_value: boosterValue ?? 1,
      uses_remaining: 1,
      activated_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.error("[shop/activate-booster POST] insert:", insertErr.message);
      return NextResponse.json({ error: "Failed to activate: " + insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[shop/activate-booster POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — consume a booster (decrement uses_remaining, delete if 0)
export async function PATCH(req: NextRequest) {
  try {
    const { boosterId } = await req.json();
    if (!boosterId) {
      return NextResponse.json({ error: "Missing boosterId" }, { status: 400 });
    }

    const { data: booster } = await supabaseAdmin
      .from("active_boosters")
      .select("id, uses_remaining")
      .eq("id", boosterId)
      .single();

    if (!booster) {
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
