// Competitive platform — participant FORFEIT (concede) endpoint.
//
// POST /api/competitive/match/[id]/forfeit
// Body: {}   // nothing from the body is trusted — the caller IS the forfeiter,
//             // determined from requireAuth, never the body.
//
// Behavior:
//   1. requireAuth + membership — only a match participant may forfeit.
//   2. Atomic claim active → completing (SAME claim /complete uses, so a
//      complete and a forfeit can never both settle the same match).
//   3. Run the SAME engagement gate as /complete, with the caller treated as
//      the conceding side:
//        - If the OPPONENT never engaged (0 responses) → VOID. The caller takes
//          NO penalty: no real contest happened, so no ELO/Fang movement.
//        - If BOTH sides engaged → the caller's team takes the forfeit LOSS
//          (forceWinner = the opponent's side, regardless of partial score), then
//          ELO + Fangs settle via the normal path and the row is marked
//          'forfeited' with forfeited_by = caller.
//   4. Idempotent: a terminal match returns its settled row.
//
// Security: userId comes ONLY from requireAuth. The settlement math + the
// engagement gate live in lib/competitive/settle.ts, shared with /complete and
// the stale-match reaper, so the void/settle decision is identical everywhere.

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
    const onTeamA = match.team_a.includes(userId);
    const onTeamB = match.team_b.includes(userId);
    if (!onTeamA && !onTeamB) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }
    if (isTerminalStatus(match.status)) {
      return NextResponse.json({ alreadyCompleted: true, match });
    }

    // Atomic claim active|completing → completing (same claim /complete uses).
    // Accepting 'completing' makes a row stranded by a prior settle throw
    // RESUMABLE here too — the retry re-runs the idempotent settler, so no
    // double Fang/ELO. Terminal rows are short-circuited above and never reach
    // the claim.
    const { data: claimed } = await supabaseAdmin
      .from("competitive_matches")
      .update({ status: "completing" })
      .eq("id", matchId)
      .in("status", ["active", "completing"])
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

    // The conceding caller's team loses IF a real contest happened. The gate in
    // the settler still VOIDs (no penalty) when the opponent never engaged.
    const forceWinner: "a" | "b" = onTeamA ? "b" : "a";
    const result = await settleClaimedMatch(supabaseAdmin, match, {
      forceWinner,
      forfeitedBy: userId,
    });

    if (result.outcome === "voided") {
      return NextResponse.json({
        ok: true,
        voided: true,
        reason: result.reason ?? "opponent-never-played",
        result: {
          winnerTeam: null,
          scoreA: result.scoreA,
          scoreB: result.scoreB,
        },
        mode: match.mode,
        format: match.format,
      });
    }

    return NextResponse.json({
      ok: true,
      forfeited: true,
      result: {
        winnerTeam: result.winnerTeam,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        eloBefore: result.eloBefore,
        eloAfter: result.eloAfter,
        eloDeltas: result.eloDeltas,
        fangDelta: result.fangDelta,
      },
      mode: match.mode,
      format: match.format,
    });
  } catch (e) {
    console.error("[competitive/forfeit]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
