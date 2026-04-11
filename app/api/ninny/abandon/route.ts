import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { NINNY_ABANDON_PENALTY } from "@/lib/ninny";

export const dynamic = "force-dynamic";

// POST /api/ninny/abandon
// Deducts the abandon penalty from the user's Fang balance when they exit
// a study session mid-way. Capped at the user's actual balance — they
// never go negative. Logs as a 'ninny_abandon' transaction for the audit.
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const before = profile.coins ?? 0;
  // Cap penalty at user's actual balance — never go negative
  const penalty = Math.min(NINNY_ABANDON_PENALTY, before);
  const after = before - penalty;

  if (penalty > 0) {
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ coins: after })
      .eq("id", userId);
    if (updateErr) {
      console.error("[ninny/abandon] update:", updateErr.message);
      return NextResponse.json({ error: "Failed to apply penalty" }, { status: 500 });
    }
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: -penalty,
      type: "ninny_abandon",
      description: "Abandoned a Ninny session mid-way",
    });
  }

  return NextResponse.json({
    success: true,
    penalty,
    balance: after,
  });
}
