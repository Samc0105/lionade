/**
 * POST /api/games/pardy/submit
 *
 * Server-side answer validation for Lionade-Pardy. Client sends the tileId
 * (deckId:catIdx:tileIdx) + the player's answer. We look up the canonical
 * tile, run normalization-based matching, and on correct grant Fangs
 * directly (no client-side amount input — value comes from the authored tile).
 *
 * Body:  { tileId: string; answer: string }
 * Response:
 *   { correct: true,  correct_answer: string, awarded: number, newCoins: number }
 *   { correct: false, correct_answer: string }
 *
 * Errors:
 *   400 — bad body / unknown tile
 *   401 — unauthenticated
 *
 * Anti-cheat: client never tells us how many Fangs to grant. The amount is
 * always derived from the authored tile.value. Multi-claim on the same tile
 * within a single session is the client's responsibility to suppress (V1).
 * V2: persist per-user-per-deck progress and refuse double-claims server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { applyFangMultiplierFromTier } from "@/lib/mastery-plan";
import { getTile } from "@/lib/pardy/decks";
import { matchPardyAnswer } from "@/lib/pardy/match";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: { tileId?: unknown; answer?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tileId = typeof body.tileId === "string" ? body.tileId : "";
  const answer = typeof body.answer === "string" ? body.answer : "";

  if (!tileId) return NextResponse.json({ error: "Missing tileId" }, { status: 400 });
  if (!answer.trim()) return NextResponse.json({ error: "Missing answer" }, { status: 400 });

  const lookup = getTile(tileId);
  if (!lookup) return NextResponse.json({ error: "Unknown tile" }, { status: 400 });
  const { tile } = lookup;

  const correct = matchPardyAnswer(answer, tile);

  if (!correct) {
    return NextResponse.json({
      correct: false,
      correct_answer: tile.correctAnswer,
    });
  }

  // Correct — grant Fangs. Read profile (coins + plan + status), apply
  // multiplier, write back, log transaction.
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins, plan, subscription_status")
      .eq("id", userId)
      .single();
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const awarded = applyFangMultiplierFromTier(
      tile.value,
      profile.plan as string | null,
      profile.subscription_status as string | null,
    );
    const newCoins = (profile.coins ?? 0) + awarded;
    await supabaseAdmin.from("profiles").update({ coins: newCoins }).eq("id", userId);
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: awarded,
      type: "game_reward",
      description: `pardy_correct ${tileId}`,
    });

    return NextResponse.json({
      correct: true,
      correct_answer: tile.correctAnswer,
      awarded,
      newCoins,
    });
  } catch (e) {
    console.error("[games/pardy/submit POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
