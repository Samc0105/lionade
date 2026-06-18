// Competitive platform — the ONE shared completion endpoint all 4 modes call.
//
// POST /api/competitive/match/[id]/complete
// Body: { abandoned?: boolean }
//   NOTHING from the body is trusted for SCORING (see HIGH 5 fix). The only flag
//   read is `abandoned` — set true by the shell's manual END MATCH during an
//   opponent-disconnect panel. It is NOT trusted for scoring; it ONLY enables the
//   recent-activity REFUSAL guard below. A normal end-of-rounds settle omits it.
//
// Behavior:
//   0. DISCONNECT-FAIRNESS GUARD (abandoned only): before claiming, if the
//      opponent shows a competitive_response within ABANDON_GUARD_MS, REFUSE
//      (HTTP 200 { ok:true, status:'opponent_active' }, row left 'active') so an
//      in-flight final /answer flush is never voided/settled unfairly. The shell
//      re-arms its grace timer and the player can retry once the opponent is
//      truly quiet (or the reaper backstops it). Normal settles skip this.
//   1. requireAuth — only a match participant may complete.
//   2. Atomic claim active|completing → completing (race guard, mirrors Arena V2
//      trick). Accepting 'completing' makes a stuck-completing row (settle threw
//      after a prior claim) RESUMABLE: the retry re-grabs it and re-runs settle,
//      which is idempotent (lib/competitive/settle.ts skips already-credited
//      users), so no double Fang/ELO. Terminal rows never reach the claim.
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

// Opponent-disconnect fairness window. If the opponent recorded ANY response
// within this window of an abandoned END MATCH, refuse to settle so their
// in-flight final /answer flush is not voided/settled unfairly. Tuned longer
// than a typical mobile-Safari HTTP answer-flush after WS suspend, shorter than
// the shell's OPPONENT_GRACE_MS (13000) so the guard fires well inside the
// window the player already waited. The reaper's RESPONSE_STALE_MS (180000) is
// unrelated and untouched.
const ABANDON_GUARD_MS = 8000;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const matchId = params.id;

  try {
    // The body is intentionally ignored for SCORING (recomputed server-side from
    // competitive_responses). The only flag read is `abandoned`, which gates the
    // disconnect-fairness refusal guard below — it never influences the outcome.
    const body = await req.json().catch(() => ({}));
    const abandoned = (body as { abandoned?: unknown })?.abandoned === true;

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

    // ── DISCONNECT-FAIRNESS GUARD (abandoned only, BEFORE the claim) ──
    // Only the shell's manual END MATCH sends abandoned:true. A normal
    // end-of-rounds settle omits the flag and keeps today's exact behavior. We
    // refuse to settle while the opponent is still visibly answering so an
    // in-flight final /answer flush is not voided/settled unfairly. We check
    // BEFORE the claim so a refusal leaves the row 'active' (a later retry, or
    // the cron reaper, can still resolve it). winner/scores are still recomputed
    // server-side at settle time — abandoned is NOT trusted for scoring.
    if (abandoned) {
      const opponentIds = match.team_a.includes(userId) ? match.team_b : match.team_a;
      if (opponentIds.length > 0) {
        const { data: lastResp } = await supabaseAdmin
          .from("competitive_responses")
          .select("submitted_at")
          .eq("match_id", matchId)
          .in("user_id", opponentIds)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastResp?.submitted_at) {
          const sinceMs = Date.now() - new Date(lastResp.submitted_at).getTime();
          if (sinceMs < ABANDON_GUARD_MS) {
            // Opponent answered within the guard window: do NOT claim, do NOT
            // settle. Row stays 'active'. Client keys off status to keep waiting.
            return NextResponse.json({ ok: true, status: "opponent_active" });
          }
        }
      }
    }

    // Atomic claim: active|completing → completing. The loser of this race (and
    // any concurrent /forfeit) re-reads the now-terminal row. Accepting
    // 'completing' lets a retry re-grab a row stranded by a prior settle throw;
    // settle is idempotent so the re-run cannot double-apply Fangs/ELO.
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
