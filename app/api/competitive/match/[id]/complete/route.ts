// Competitive platform — the ONE shared completion endpoint all 4 modes call.
//
// POST /api/competitive/match/[id]/complete
// Body: {}   // NOTHING from the body is trusted for scoring (see HIGH 5 fix).
//
// Behavior:
//   1. requireAuth — only a match participant may complete.
//   2. Atomic claim active → completing (race guard, mirrors Arena V2 trick).
//   3. THE ENGAGEMENT GATE (lib/competitive/settle.ts): ELO + Fangs settle ONLY
//      when BOTH teams recorded at least one competitive_response. If one side
//      has ZERO responses (no-show / instant disconnect / never engaged), the
//      match is VOIDED — status 'voided', NO ELO change, NO Fang transfer, no
//      penalty to the player who did show. A mid-match quit where BOTH sides
//      answered at least once IS a real contest and settles normally (the
//      quitter's unanswered rounds score 0 → they likely lose → ELO moves).
//   4. When both engaged: winner from SERVER-PERSISTED competitive_responses
//      points, K=32 team ELO on the format ladder, locked Fang payout table,
//      shared 24h loss-cap clamp, persist elo_before/after/fang_delta jsonb.
//
// Security: userId comes ONLY from requireAuth, never the body. The match
// outcome is computed EXCLUSIVELY from server-written rows (competitive_responses)
// — a client can no longer submit a score to win. Fang debits are clamped so a
// user can never go below 0 and never exceed the loss cap.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { settleClaimedMatch } from "@/lib/competitive/settle";
import { type CompetitiveMatchRow, isTerminalStatus } from "@/lib/competitive/types";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const matchId = params.id;

  try {
    // The body is intentionally ignored for scoring; the outcome is recomputed
    // server-side from competitive_responses.
    await req.json().catch(() => ({}));

    const { data: matchRaw } = await supabaseAdmin
      .from("competitive_matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (!matchRaw) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    const match = matchRaw as CompetitiveMatchRow;
    const participants = [...match.team_a, ...match.team_b];
    if (!participants.includes(userId)) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }
    // A voided / forfeited / completed match is terminal — a second completer
    // just gets the settled row back, never a re-settle.
    if (isTerminalStatus(match.status)) {
      return NextResponse.json({ alreadyCompleted: true, match });
    }

    // Atomic claim: active → completing. The loser of this race (and any
    // concurrent /forfeit) re-reads the now-terminal row.
    const { data: claimed } = await supabaseAdmin
      .from("competitive_matches")
      .update({ status: "completing" })
      .eq("id", matchId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      const { data: refetch } = await supabaseAdmin
        .from("competitive_matches")
        .select("*")
        .eq("id", matchId)
        .single();
      return NextResponse.json({ alreadyCompleted: true, match: refetch });
    }

    // The gate + ELO/Fang math live in the shared settler.
    const result = await settleClaimedMatch(supabaseAdmin, match);

    if (result.outcome === "voided") {
      return NextResponse.json({
        matchId,
        voided: true,
        reason: result.reason ?? "opponent-never-played",
        winnerTeam: null,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        mode: match.mode,
        format: match.format,
      });
    }

    return NextResponse.json({
      matchId,
      winnerTeam: result.winnerTeam,
      scoreA: result.scoreA,
      scoreB: result.scoreB,
      eloBefore: result.eloBefore,
      eloAfter: result.eloAfter,
      eloDeltas: result.eloDeltas,
      fangDelta: result.fangDelta,
      mode: match.mode,
      format: match.format,
    });
  } catch (e) {
    console.error("[competitive/complete]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
