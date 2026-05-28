// Competitive platform — the ONE shared completion endpoint all 5 modes call.
//
// POST /api/competitive/match/[id]/complete
// Body: { scores: { "<user_id>": number, ... } }   // per-user raw mode score
//   OR (Poker Face): { potSettled: true }           // pot already settled per-hand
//
// Behavior:
//   1. requireAuth — only a match participant may complete.
//   2. Atomic claim active → completing (race guard, mirrors Arena V2 trick).
//   3. Determine winner_team from the submitted per-user scores (team sum).
//   4. ELO: K=32 team update on the format's ladder (competitive_elo for 1v1,
//      squad_elo for 2v2). Pool-conserved (team A gain == team B loss).
//   5. Fang settle: locked payout table (lib/competitive/fang-payout.ts). For
//      Poker Face the pot is settled per-hand already, so this endpoint applies
//      ONLY the flat participation here (the pot deltas were written to each
//      hand and rolled into fang_delta by the pokerface hand endpoint).
//   6. Loss-cap enforcement (SHARED 24h budget across Arena + all competitive
//      modes): if a user is already at/below their tier cap, a losing/negative
//      delta is clamped to 0 (we stop the bleeding; we never refund).
//   7. Persist elo_before/elo_after/fang_delta jsonb + winner_team + status.
//
// Security: userId comes ONLY from requireAuth, never the body. The score map
// is validated to contain ONLY the match's participants. Fang debits are
// clamped so a user can never go below 0 and never exceed the loss cap.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  resolveLossCapTier,
  computeLossWindow,
  isLossCapReached,
} from "@/lib/arena-v2/loss-cap";
import { buildEloDeltas } from "@/lib/competitive/elo";
import { resolvePayout, pokerFaceParticipation } from "@/lib/competitive/fang-payout";
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
    const body = await req.json().catch(() => ({}));
    const scores: Record<string, number> = body?.scores ?? {};

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

    // ── Determine winner via team score sums ──
    const sum = (team: string[]) =>
      team.reduce((acc, u) => acc + (typeof scores[u] === "number" ? scores[u] : 0), 0);
    const scoreA = sum(match.team_a);
    const scoreB = sum(match.team_b);
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

    // Poker Face: the staked pot is settled per-hand and already accumulated on
    // the match row's fang_delta. Here we only ADD the flat participation.
    const isPokerFace = match.mode === "pokerface";
    const existingFangDelta = (match.fang_delta ?? {}) as Record<string, number>;

    for (const u of participants) {
      const onTeamA = match.team_a.includes(u);
      const isWinner =
        winner !== "draw" && ((winner === "a" && onTeamA) || (winner === "b" && !onTeamA));
      const isLoser = winner !== "draw" && !isWinner;

      let intended: number;
      if (isPokerFace) {
        intended = pokerFaceParticipation(format) + (existingFangDelta[u] ?? 0);
      } else if (winner === "draw") {
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
