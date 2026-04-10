import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Per-game reward caps. Must match the actual game logic in app/games/page.tsx.
const MAX_REWARD_BY_GAME: Record<string, number> = {
  roardle: 50, // base 20 + bonus up to 18 ≈ 38, cap 50
  blitz: 60, // up to 30 correct × 2 = 60
  flashcards: 20, // 100% × 15 ≈ 15, cap 20
  timeline: 25, // 8 events × 3 = 24
};

const VALID_GAMES = Object.keys(MAX_REWARD_BY_GAME);

// POST — Award Fangs for game completion
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json();
    const gameType = String(body.gameType ?? "");
    const amount = Number(body.amount ?? 0);

    if (!gameType || !amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!VALID_GAMES.includes(gameType)) {
      return NextResponse.json({ error: "Unknown game" }, { status: 400 });
    }
    // Server-side cap — client cannot grant arbitrary amounts
    const cap = MAX_REWARD_BY_GAME[gameType];
    const safeAmount = Math.max(0, Math.min(cap, Math.floor(amount)));
    if (safeAmount === 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // Get current coins
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();

    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const newCoins = (profile.coins ?? 0) + safeAmount;
    await supabaseAdmin.from("profiles").update({ coins: newCoins }).eq("id", userId);

    // Log transaction
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: safeAmount,
      type: "game_reward",
      description: `${gameType} game reward`,
    });

    return NextResponse.json({ success: true, newCoins });
  } catch (e) {
    console.error("[games/reward POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
