import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// POST — Award Fangs for game completion
export async function POST(req: NextRequest) {
  try {
    const { userId, amount, gameType, description } = await req.json();
    if (!userId || !amount || !gameType) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Get current coins
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();

    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const newCoins = (profile.coins ?? 0) + amount;
    await supabaseAdmin.from("profiles").update({ coins: newCoins }).eq("id", userId);

    // Log transaction
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount,
      type: "game_reward",
      description: description ?? `${gameType} game reward`,
    });

    return NextResponse.json({ success: true, newCoins });
  } catch (e) {
    console.error("[games/reward POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
