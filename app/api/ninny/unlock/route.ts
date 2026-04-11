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

  // Atomic deduct via optimistic concurrency control: only update if the
  // coins value still matches what we read. If a concurrent request beat us
  // to it, the update will affect 0 rows and we know to fail safely without
  // double-charging.
  const { data: chargeRow, error: chargeErr } = await supabaseAdmin
    .from("profiles")
    .update({ coins: before - cost })
    .eq("id", userId)
    .eq("coins", before)
    .select("id")
    .maybeSingle();

  if (chargeErr) {
    console.error("[ninny/unlock] charge:", chargeErr.message);
    return NextResponse.json({ error: "Charge failed" }, { status: 500 });
  }
  if (!chargeRow) {
    // Either balance changed since we read it (race) or row was deleted.
    // Don't double-charge — return a 409 so the client can retry.
    return NextResponse.json(
      { error: "Balance changed, please try again" },
      { status: 409 },
    );
  }

  // Atomic array append: only update if unlocked_modes is still what we read.
  // Prevents losing a concurrent unlock for a different mode.
  const newUnlockedModes = [...unlockedModes, mode];
  const { data: updateRow, error: updateErr } = await supabaseAdmin
    .from("ninny_materials")
    .update({ unlocked_modes: newUnlockedModes })
    .eq("id", materialId)
    .contains("unlocked_modes", unlockedModes)
    .select("id")
    .maybeSingle();

  if (updateErr || !updateRow) {
    // Refund the charge — the update failed or another mode was unlocked
    // concurrently. The user should retry; their balance is intact.
    await supabaseAdmin
      .from("profiles")
      .update({ coins: before })
      .eq("id", userId);
    if (updateErr) console.error("[ninny/unlock] update:", updateErr.message);
    return NextResponse.json(
      { error: "Failed to unlock mode, balance refunded" },
      { status: 500 },
    );
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
