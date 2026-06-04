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
 * always derived from the authored tile.value. Replay protection via the
 * pardy_tile_claims table — INSERT-FIRST on (user_id, tile_id) UNIQUE PK
 * means a duplicate-submit returns the same "correct" response but does
 * NOT award Fangs again. A correctly-answered tile can only pay once per
 * user, ever.
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

  // Correct — but replay-protect via INSERT-FIRST on pardy_tile_claims.
  // The UNIQUE PK (user_id, tile_id) means the same (user, tile) can only
  // ever claim once. A replay attempt returns the same correct response
  // (so the UI flow doesn't break) but does NOT award Fangs again.
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan, subscription_status")
      .eq("id", userId)
      .single();
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const awarded = applyFangMultiplierFromTier(
      tile.value,
      profile.plan as string | null,
      profile.subscription_status as string | null,
    );

    // INSERT-FIRST: if a row already exists with the same (user_id, tile_id),
    // the UNIQUE constraint rejects this with PostgreSQL 23505. We surface
    // that as "already claimed" — the response stays `correct: true` so the
    // UI behaves identically, but `awarded: 0` and `already_claimed: true`.
    const { error: claimErr } = await supabaseAdmin
      .from("pardy_tile_claims")
      .insert({ user_id: userId, tile_id: tileId, awarded_fangs: awarded });

    if (claimErr) {
      if (claimErr.code === "23505") {
        return NextResponse.json({
          correct: true,
          correct_answer: tile.correctAnswer,
          awarded: 0,
          already_claimed: true,
        });
      }
      console.error("[games/pardy/submit POST] claim insert:", claimErr);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    // Atomic coin grant via the existing update_user_coins RPC. p_source
    // 'cashable' routes to the cashable bucket (gameplay rewards, future-
    // cashable in V2). No read-modify-write race possible.
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
      "update_user_coins",
      {
        p_user_id: userId,
        p_delta: awarded,
        p_min_balance: 0,
        p_source: "cashable",
      },
    );

    if (rpcErr) {
      // Claim already inserted; coin grant failed. Compensating action:
      // delete the claim row so the user can retry. This is a rare branch
      // (DB issues only) but failing-loud is better than silent gap.
      await supabaseAdmin
        .from("pardy_tile_claims")
        .delete()
        .eq("user_id", userId)
        .eq("tile_id", tileId);
      console.error("[games/pardy/submit POST] coin rpc:", rpcErr);
      return NextResponse.json({ error: "Reward failed" }, { status: 500 });
    }

    const newCoins = Array.isArray(rpcData)
      ? (rpcData[0]?.new_coins ?? null)
      : ((rpcData as { new_coins?: number } | null)?.new_coins ?? null);

    // Audit row in coin_transactions (separate from the atomic RPC for
    // analytics; non-fatal on error).
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
