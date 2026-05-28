// Competitive platform — the ONE shared completion endpoint all 5 modes call.
//
// POST /api/competitive/match/[id]/complete
// Body: {}   // NOTHING from the body is trusted for scoring (see HIGH 5 fix).
//
// Behavior:
//   1. requireAuth — only a match participant may complete.
//   2. Atomic claim active → completing (race guard, mirrors Arena V2 trick).
//   3. Determine winner_team from SERVER-PERSISTED scores:
//        - all modes (sabotage/zoom/spectrum/pin): sum each team's
//          competitive_responses.points. The /answer route scored every guess
//          server-side against the round secret, so the body cannot influence
//          the outcome.
//   4. ELO: K=32 team update on the format's ladder (competitive_elo for 1v1,
//      squad_elo for 2v2). Pool-conserved (team A gain == team B loss).
//   5. Fang settle: locked payout table (lib/competitive/fang-payout.ts).
//   6. Loss-cap enforcement (SHARED 24h budget across Arena + all competitive
//      modes): if a user is already at/below their tier cap, a losing/negative
//      delta is clamped to 0 (we stop the bleeding; we never refund).
//   7. Persist elo_before/elo_after/fang_delta jsonb + winner_team + status.
//
// (Poker Face was moved to Lionade Party as a no-Fang party game on 2026-05-28;
// there is no longer a per-hand staked-pot mode here.)
//
// Security: userId comes ONLY from requireAuth, never the body. The match
// outcome is computed EXCLUSIVELY from server-written rows (competitive_responses)
// — a client can no longer submit a score to win. Fang debits are clamped so a
// user can never go below 0 and never exceed the loss cap.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  resolveLossCapTier,
  computeLossWindow,
  isLossCapReached,
} from "@/lib/competitive/loss-cap";
import { buildEloDeltas } from "@/lib/competitive/elo";
import { resolvePayout } from "@/lib/competitive/fang-payout";
import { eloColumnForFormat, type CompetitiveMatchRow, type CompetitiveFormat } from "@/lib/competitive/types";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const matchId = params.id;

  try {
    // NOTE: the body is intentionally ignored for scoring. Any score map a
    // client submits is discarded; the outcome is recomputed server-side.
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
    if (match.status === "completed") {
      return NextResponse.json({ alreadyCompleted: true, match });
    }

    // Atomic claim: active → completing.
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

    // ── Determine winner from SERVER-PERSISTED scores (never the body) ──
    // Every mode sums its team's server-scored competitive_responses.points.
    let scoreA = 0;
    let scoreB = 0;

    const { data: responses } = await supabaseAdmin
      .from("competitive_responses")
      .select("user_id, points")
      .eq("match_id", matchId);
    const byUser: Record<string, number> = {};
    for (const r of responses ?? []) {
      byUser[r.user_id] = (byUser[r.user_id] ?? 0) + (r.points ?? 0);
    }
    scoreA = match.team_a.reduce((acc, u) => acc + (byUser[u] ?? 0), 0);
    scoreB = match.team_b.reduce((acc, u) => acc + (byUser[u] ?? 0), 0);

    let winner: "a" | "b" | "draw";
    if (scoreA > scoreB) winner = "a";
    else if (scoreB > scoreA) winner = "b";
    else winner = "draw";

    const winnerTeam: "a" | "b" | "draw" = winner;

    // ── ELO (K=32) on the format's ladder ──
    const format: CompetitiveFormat = match.format;
    const eloCol = eloColumnForFormat(format);

    // Read current ladder ratings for all participants.
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select(`id, coins, plan, competitive_elo, squad_elo`)
      .in("id", participants);

    const eloBefore: Record<string, number> = {};
    const coinsBefore: Record<string, number> = {};
    const planMap: Record<string, string | null> = {};
    for (const p of profiles ?? []) {
      eloBefore[p.id] = (eloCol === "squad_elo" ? p.squad_elo : p.competitive_elo) ?? 1000;
      coinsBefore[p.id] = p.coins ?? 0;
      planMap[p.id] = p.plan ?? null;
    }

    const { deltas: eloDeltas, eloAfter } = buildEloDeltas({
      teamA: match.team_a,
      teamB: match.team_b,
      eloBefore,
      winner,
    });

    // ── Fang settle ──
    const payout = resolvePayout({ mode: match.mode, format });
    const fangDelta: Record<string, number> = {};

    for (const u of participants) {
      const onTeamA = match.team_a.includes(u);
      const isWinner =
        winner !== "draw" && ((winner === "a" && onTeamA) || (winner === "b" && !onTeamA));
      const isLoser = winner !== "draw" && !isWinner;

      let intended: number;
      if (winner === "draw") {
        intended = payout.drawDelta;
      } else if (isWinner) {
        intended = payout.winnerDelta;
      } else if (isLoser) {
        intended = payout.loserDelta;
      } else {
        intended = 0;
      }
      fangDelta[u] = intended;
    }

    // ── Loss-cap enforcement (per user) + balance clamp ──
    // For each user with a NEGATIVE intended delta, if their 24h net is already
    // at/below the tier cap, clamp the negative portion to 0. We never refund;
    // we stop the bleeding. Positive deltas (wins/participation) are unaffected.
    const profileWrites: Array<PromiseLike<unknown>> = [];
    const cappedFangDelta: Record<string, number> = {};

    for (const u of participants) {
      let delta = fangDelta[u];
      if (delta < 0) {
        const tier = resolveLossCapTier({ elo: eloBefore[u], isPro: planMap[u] === "pro" });
        const lossWindow = await computeLossWindow(supabaseAdmin, u);
        const capReached = isLossCapReached({
          netFangsLast24h: lossWindow.netFangsLast24h,
          tier,
        });
        if (capReached) delta = 0;
      }
      // Never let a balance go negative.
      const newCoins = Math.max(0, coinsBefore[u] + delta);
      // Recompute the effective delta after the floor clamp (so fang_delta and
      // the loss-cap accounting stay consistent with what actually moved).
      const effectiveDelta = newCoins - coinsBefore[u];
      cappedFangDelta[u] = effectiveDelta;

      const update: Record<string, unknown> = { coins: newCoins };
      update[eloCol] = eloAfter[u];
      profileWrites.push(
        supabaseAdmin.from("profiles").update(update).eq("id", u),
      );
    }

    await Promise.all(profileWrites);

    // ── Persist the match row ──
    await supabaseAdmin
      .from("competitive_matches")
      .update({
        status: "completed",
        winner_team: winnerTeam,
        elo_before: eloBefore,
        elo_after: eloAfter,
        fang_delta: cappedFangDelta,
        completed_at: new Date().toISOString(),
      })
      .eq("id", matchId);

    return NextResponse.json({
      matchId,
      winnerTeam,
      scoreA,
      scoreB,
      eloBefore,
      eloAfter,
      eloDeltas,
      fangDelta: cappedFangDelta,
      mode: match.mode,
      format,
    });
  } catch (e) {
    console.error("[competitive/complete]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
