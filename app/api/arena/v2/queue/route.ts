// Arena V2 — async ghost queue entry.
//
// POST body: { subject: string, wager: number }
//
// Behavior (gated behind isArenaV2Enabled — V1 is untouched):
//   1. Validate stake against the V2 ladder (10/25/50/100, plus 250 if
//      ELO >= 1500). Reject if user lacks Fangs.
//   2. Try the sync queue for 30s — Phase 1 stub leaves sync flow on V1
//      (Phase 2 will merge). For now we go straight to async ghost match.
//   3. Call ghost-matcher cascade.
//   4. If matched (real OR trainer): create an arena_matches row marked
//      `is_async=true`, copy ghost.question_ids, seed arena_match_questions
//      rows, and return matchId so the client opens the duel screen.
//   5. If no ghost: return { status: "no_ghost_available" }.
//
// IMPORTANT: We deduct the stake at COMPLETE, not at queue-entry — V2 keeps
// the V1 atomicity (winner-takes-stake on completion). The stake check here
// is a pre-flight only.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/feature-flag";
import { findGhost } from "@/lib/arena-v2/ghost-matcher";

const V1_STAKES = [10, 25, 50, 100];
const HIGH_TIER_STAKE = 250;
const HIGH_TIER_MIN_ELO = 1500;

export async function POST(req: NextRequest) {
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ error: "Arena V2 disabled" }, { status: 404 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json();
    const subject: string | undefined = body?.subject;
    const wager: number = typeof body?.wager === "number" ? body.wager : 10;

    if (!subject || typeof subject !== "string") {
      return NextResponse.json({ error: "Missing subject" }, { status: 400 });
    }

    // Profile read: ELO, Fangs, Pro status (via plan).
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, coins, arena_elo, plan")
      .eq("id", userId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const userElo = profile.arena_elo ?? 1000;

    // Stake validation.
    const allowedStakes = userElo >= HIGH_TIER_MIN_ELO
      ? [...V1_STAKES, HIGH_TIER_STAKE]
      : V1_STAKES;
    if (!allowedStakes.includes(wager)) {
      return NextResponse.json({ error: "Invalid stake" }, { status: 400 });
    }
    if ((profile.coins ?? 0) < wager) {
      return NextResponse.json({ error: "Not enough Fangs" }, { status: 400 });
    }

    // Match cascade.
    const result = await findGhost({
      supabase: supabaseAdmin,
      userId,
      userElo,
      subject,
    });

    if (result.status === "no_ghost_available" || !result.ghost) {
      return NextResponse.json({ status: "no_ghost_available" });
    }

    const ghost = result.ghost;
    const effectiveWager = ghost.isMismatched ? Math.floor(wager / 2) : wager;

    // Create arena_matches row. Note: ghost owner is player2 for record
    // purposes, but we mark is_async=true so the duel screen reads from
    // the ghost's recorded answers instead of waiting for player2 input.
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("arena_matches")
      .insert({
        player1_id: userId,
        player2_id: ghost.owner_user_id,
        question_ids: ghost.question_ids,
        wager: effectiveWager,
        status: "active",
        current_question: 0,
        player1_elo_before: userElo,
        player2_elo_before: ghost.elo_at_recording,
        is_async: true,
        ghost_id: ghost.id,
        is_trainer_match: ghost.is_trainer,
        subject,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (matchErr || !match) {
      console.error("[arena/v2/queue] insert match", matchErr?.message);
      return NextResponse.json({ error: "Couldn't create match" }, { status: 500 });
    }

    // Seed arena_match_questions in ghost's recorded order.
    const mqRows = ghost.question_ids.map((qid, i) => ({
      match_id: match.id,
      question_id: qid,
      question_order: i,
      time_limit: 15,
      cognitive_load: "recall" as const,
    }));
    if (mqRows.length > 0) {
      await supabaseAdmin.from("arena_match_questions").insert(mqRows);
    }

    return NextResponse.json({
      status: result.status, // "matched" | "trainer_ninny"
      matchId: match.id,
      ghostId: ghost.id,
      isTrainer: ghost.is_trainer,
      isMismatched: ghost.isMismatched,
      effectiveWager,
      subject,
    });
  } catch (e) {
    console.error("[arena/v2/queue]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
