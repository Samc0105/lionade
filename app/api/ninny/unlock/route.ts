import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  getNinnyModeCost,
  NINNY_MODE_COSTS,
  type NinnyMode,
} from "@/lib/ninny";

export const dynamic = "force-dynamic";

const VALID_MODES: NinnyMode[] = Object.keys(NINNY_MODE_COSTS) as NinnyMode[];

// POST /api/ninny/unlock
// Charges the user the mode's price and adds the mode to the material's
// unlocked_modes array. Used when the user wants to play an additional
// mode on a material they've already generated.
//
// Body: { materialId: string, mode: NinnyMode }
// Response: { unlockedModes: string[], userCoins: number }
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: { materialId?: string; mode?: NinnyMode };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { materialId, mode } = body;

  if (!materialId || !mode) {
    return NextResponse.json({ error: "Missing materialId or mode" }, { status: 400 });
  }
  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  // Verify material ownership + check current unlock state
  const { data: material, error: matErr } = await supabaseAdmin
    .from("ninny_materials")
    .select("id, user_id, unlocked_modes")
    .eq("id", materialId)
    .single();

  if (matErr || !material || material.user_id !== userId) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  const unlockedModes: string[] = material.unlocked_modes ?? [];

  // If already unlocked, this is a no-op — return current state
  if (unlockedModes.includes(mode)) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();
    return NextResponse.json({
      alreadyUnlocked: true,
      unlockedModes,
      userCoins: profile?.coins ?? 0,
    });
  }

  // Charge the user the mode's price
  const cost = getNinnyModeCost(mode);
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 500 });
  }

  const before = profile.coins ?? 0;
  if (before < cost) {
    return NextResponse.json(
      {
        error: `Need ${cost} Fangs to unlock ${mode}. You have ${before}.`,
        cost,
        userCoins: before,
        insufficientFangs: true,
      },
      { status: 402 },
    );
  }

  // Atomic deduct + append in two updates (no transactions in Supabase REST,
  // but the second update is conditional via the constraint the unlock array
  // already had the previous value)
  const { error: chargeErr } = await supabaseAdmin
    .from("profiles")
    .update({ coins: before - cost })
    .eq("id", userId);

  if (chargeErr) {
    console.error("[ninny/unlock] charge:", chargeErr.message);
    return NextResponse.json({ error: "Charge failed" }, { status: 500 });
  }

  const newUnlockedModes = [...unlockedModes, mode];
  const { error: updateErr } = await supabaseAdmin
    .from("ninny_materials")
    .update({ unlocked_modes: newUnlockedModes })
    .eq("id", materialId);

  if (updateErr) {
    // Refund the charge
    await supabaseAdmin
      .from("profiles")
      .update({ coins: before })
      .eq("id", userId);
    console.error("[ninny/unlock] update:", updateErr.message);
    return NextResponse.json({ error: "Failed to unlock mode" }, { status: 500 });
  }

  // Log the spend
  await supabaseAdmin.from("coin_transactions").insert({
    user_id: userId,
    amount: -cost,
    type: "ninny_unlock",
    description: `Unlocked ${mode} mode`,
  });

  return NextResponse.json({
    success: true,
    unlockedModes: newUnlockedModes,
    userCoins: before - cost,
  });
}
