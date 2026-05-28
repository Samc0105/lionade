// Poker Face — caller responds, reveal + zero-sum settle.
//
// POST /api/competitive/pokerface/call
// Body: { matchId, handNum, call: "believe" | "doubt" }
//
// Only the hand's caller may call. We resolve the confidence-wager matrix
// (lib/competitive/pokerface-wager.ts), transfer the staked Fangs ZERO-SUM
// between presenter and caller (winner-takes the staked amount; no rake), and
// ACCUMULATE the signed per-user delta onto the match row's fang_delta jsonb so
// the shared /complete endpoint folds it into the final settle + loss cap.
//
// We DO NOT debit balances here — the pot is recorded as a pending delta on the
// match row and applied atomically at /complete (single source of truth for the
// loss-cap clamp + balance floor). This mirrors Arena's "settle at complete"
// invariant and avoids a hand-by-hand balance-drift race.
//
// SECURITY: userId from requireAuth only. Caller validated against the hand.
// The presenter's is_truth was committed at present time and is read server-side
// (never trusted from the body), so the caller can't peek.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { resolveHand, SMALL_WIN_FRACTION, type Call } from "@/lib/competitive/pokerface-wager";
import type { CompetitiveMatchRow } from "@/lib/competitive/types";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json().catch(() => ({}));
    const matchId: string | undefined = body?.matchId;
    const handNum: number = Number.isInteger(body?.handNum) ? body.handNum : -1;
    const call = body?.call as Call | undefined;

    if (!matchId || handNum < 0 || (call !== "believe" && call !== "doubt")) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const { data: hand } = await supabaseAdmin
      .from("pokerface_hands")
      .select("*")
      .eq("match_id", matchId)
      .eq("hand_num", handNum)
      .maybeSingle();
    if (!hand) return NextResponse.json({ error: "Hand not found" }, { status: 404 });
    if (hand.caller_id !== userId) {
      return NextResponse.json({ error: "Not the caller for this hand" }, { status: 403 });
    }
    if (hand.phase === "done") {
      return NextResponse.json({ alreadyResolved: true, hand });
    }

    // Resolve the confidence-wager matrix.
    const { winner, magnitude } = resolveHand({
      presenterToldTruth: hand.is_truth === true,
      call,
    });
    const stake = hand.total_stake as number;
    const amount =
      magnitude === "full" ? stake : Math.round(stake * SMALL_WIN_FRACTION);

    const winnerId = winner === "presenter" ? hand.presenter_id : hand.caller_id;
    const loserId = winner === "presenter" ? hand.caller_id : hand.presenter_id;

    // ── Accumulate the zero-sum pot delta onto the match row ──
    const { data: matchRaw } = await supabaseAdmin
      .from("competitive_matches")
      .select("*")
      .eq("id", matchId)
      .single();
    const match = matchRaw as CompetitiveMatchRow;
    const fd = { ...(match.fang_delta ?? {}) } as Record<string, number>;
    fd[winnerId] = (fd[winnerId] ?? 0) + amount;
    fd[loserId] = (fd[loserId] ?? 0) - amount;

    await supabaseAdmin
      .from("competitive_matches")
      .update({ fang_delta: fd })
      .eq("id", matchId);

    // Mark the hand resolved.
    await supabaseAdmin
      .from("pokerface_hands")
      .update({
        caller_call: call,
        winner_id: winnerId,
        phase: "done",
        ended_at: new Date().toISOString(),
      })
      .eq("id", hand.id);

    return NextResponse.json({
      ok: true,
      handNum,
      cardWord: hand.card_word,
      cardFact: hand.card_fact,
      claimShown: hand.claim_text,
      presenterToldTruth: hand.is_truth === true,
      call,
      winner,
      winnerId,
      amount,
      stake,
    });
  } catch (e) {
    console.error("[competitive/pokerface/call]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
