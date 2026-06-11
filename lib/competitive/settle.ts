// Competitive platform — the ONE shared settlement core.
//
// This is the single source of truth for the principle:
//
//   ELO + Fangs settle ONLY when BOTH teams recorded at least one
//   competitive_response (a real contest happened). If one side has ZERO
//   responses (no-show / instant disconnect / never engaged), the match is
//   VOIDED: status 'voided', NO ELO change, NO Fang transfer, no penalty to the
//   player who did show.
//
// Used by THREE callers, all of which first win the atomic active->completing
// claim and pass the claimed row in here:
//   - /api/competitive/match/[id]/complete  (normal end — winner from scores)
//   - /api/competitive/match/[id]/forfeit   (a participant concedes)
//   - /api/cron/reap-stale-competitive       (AFK / hung-match reaper)
//
// The caller MUST have already flipped the row active -> completing. This fn
// reads competitive_responses, applies the engagement gate, and writes the
// terminal row + (only when both engaged) the profiles ELO/Fang mutations.
//
// Security: scoring is computed EXCLUSIVELY from server-written
// competitive_responses rows. No client-submitted score is ever trusted.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveLossCapTier,
  computeLossWindow,
  isLossCapReached,
} from "./loss-cap";
import { buildEloDeltas } from "./elo";
import { resolvePayout } from "./fang-payout";
import { eloColumnForFormat, type CompetitiveMatchRow, type CompetitiveFormat } from "./types";

export interface SettleOptions {
  /**
   * Override the winner determination. When set, the score-derived winner is
   * IGNORED and this side is treated as the winner. Used by /forfeit to force
   * the conceding side to lose. Note: the engagement gate runs FIRST and can
   * still VOID the match (no penalty) regardless of this override.
   */
  forceWinner?: "a" | "b";
  /** Who conceded, recorded on the row when this is a forfeit settlement. */
  forfeitedBy?: string;
}

export interface SettleResult {
  outcome: "voided" | "settled";
  /** Set only when voided. */
  reason?: string;
  /** Final status written to the row. */
  status: "voided" | "completed" | "forfeited";
  winnerTeam: "a" | "b" | "draw" | null;
  scoreA: number;
  scoreB: number;
  eloBefore: Record<string, number>;
  eloAfter: Record<string, number>;
  /** Per-user signed ELO change (eloAfter - eloBefore). Zero map on a void. */
  eloDeltas: Record<string, number>;
  fangDelta: Record<string, number>;
}

/**
 * Settle a match that has ALREADY been atomically claimed into 'completing'.
 *
 * Returns the terminal result. On a void NO profile rows are touched. On a real
 * contest the ELO + Fang mutations are applied exactly as the legacy /complete
 * path did (this fn is the extraction of that math, with the gate bolted in
 * front and an optional forced winner for forfeits).
 */
export async function settleClaimedMatch(
  supabase: SupabaseClient,
  match: CompetitiveMatchRow,
  opts: SettleOptions = {},
): Promise<SettleResult> {
  const participants = [...match.team_a, ...match.team_b];

  // ── Score + per-user response counts from SERVER-PERSISTED rows ──
  const { data: responses } = await supabase
    .from("competitive_responses")
    .select("user_id, points")
    .eq("match_id", match.id);

  const pointsByUser: Record<string, number> = {};
  const responseCountByUser: Record<string, number> = {};
  for (const r of responses ?? []) {
    pointsByUser[r.user_id] = (pointsByUser[r.user_id] ?? 0) + (r.points ?? 0);
    responseCountByUser[r.user_id] = (responseCountByUser[r.user_id] ?? 0) + 1;
  }

  const scoreA = match.team_a.reduce((acc, u) => acc + (pointsByUser[u] ?? 0), 0);
  const scoreB = match.team_b.reduce((acc, u) => acc + (pointsByUser[u] ?? 0), 0);

  // ── THE GATE: did BOTH teams record at least one response? ──
  // A team "engaged" if ANY of its members has >=1 competitive_response.
  const teamAEngaged = match.team_a.some((u) => (responseCountByUser[u] ?? 0) > 0);
  const teamBEngaged = match.team_b.some((u) => (responseCountByUser[u] ?? 0) > 0);

  if (!teamAEngaged || !teamBEngaged) {
    // No real contest. VOID: unchanged ELO, zero Fang delta, no penalty.
    const eloBefore = await readEloBefore(supabase, match, participants);
    const fangDelta: Record<string, number> = {};
    const eloDeltas: Record<string, number> = {};
    for (const u of participants) {
      fangDelta[u] = 0;
      eloDeltas[u] = 0;
    }

    await supabase
      .from("competitive_matches")
      .update({
        status: "voided",
        winner_team: null,
        elo_before: eloBefore,
        elo_after: eloBefore, // unchanged
        fang_delta: fangDelta,
        forfeited_by: opts.forfeitedBy ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", match.id);

    return {
      outcome: "voided",
      reason: "opponent-never-played",
      status: "voided",
      winnerTeam: null,
      scoreA,
      scoreB,
      eloBefore,
      eloAfter: eloBefore,
      eloDeltas,
      fangDelta,
    };
  }

  // ── BOTH engaged: settle exactly as the legacy /complete path did ──
  let winner: "a" | "b" | "draw";
  if (opts.forceWinner) {
    winner = opts.forceWinner;
  } else if (scoreA > scoreB) {
    winner = "a";
  } else if (scoreB > scoreA) {
    winner = "b";
  } else {
    winner = "draw";
  }
  const winnerTeam: "a" | "b" | "draw" = winner;

  const format: CompetitiveFormat = match.format;
  const eloCol = eloColumnForFormat(format);

  const { data: profiles } = await supabase
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
    if (winner === "draw") intended = payout.drawDelta;
    else if (isWinner) intended = payout.winnerDelta;
    else if (isLoser) intended = payout.loserDelta;
    else intended = 0;
    fangDelta[u] = intended;
  }

  // ── Loss-cap enforcement (per user) + balance clamp ──
  const profileWrites: Array<PromiseLike<unknown>> = [];
  const cappedFangDelta: Record<string, number> = {};

  for (const u of participants) {
    let delta = fangDelta[u];
    if (delta < 0) {
      const tier = resolveLossCapTier({ elo: eloBefore[u], isPro: planMap[u] === "pro" });
      const lossWindow = await computeLossWindow(supabase, u);
      const capReached = isLossCapReached({
        netFangsLast24h: lossWindow.netFangsLast24h,
        tier,
      });
      if (capReached) delta = 0;
    }
    const newCoins = Math.max(0, coinsBefore[u] + delta);
    const effectiveDelta = newCoins - coinsBefore[u];
    cappedFangDelta[u] = effectiveDelta;

    const update: Record<string, unknown> = { coins: newCoins };
    update[eloCol] = eloAfter[u];
    profileWrites.push(supabase.from("profiles").update(update).eq("id", u));
  }

  await Promise.all(profileWrites);

  const finalStatus: "completed" | "forfeited" = opts.forfeitedBy ? "forfeited" : "completed";

  await supabase
    .from("competitive_matches")
    .update({
      status: finalStatus,
      winner_team: winnerTeam,
      elo_before: eloBefore,
      elo_after: eloAfter,
      fang_delta: cappedFangDelta,
      forfeited_by: opts.forfeitedBy ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", match.id);

  return {
    outcome: "settled",
    status: finalStatus,
    winnerTeam,
    scoreA,
    scoreB,
    eloBefore,
    eloAfter,
    eloDeltas,
    fangDelta: cappedFangDelta,
  };
}

/** Read each participant's current ladder rating (for the void's unchanged map). */
async function readEloBefore(
  supabase: SupabaseClient,
  match: CompetitiveMatchRow,
  participants: string[],
): Promise<Record<string, number>> {
  const eloCol = eloColumnForFormat(match.format);
  const { data: profiles } = await supabase
    .from("profiles")
    .select(`id, competitive_elo, squad_elo`)
    .in("id", participants);
  const eloBefore: Record<string, number> = {};
  for (const p of profiles ?? []) {
    eloBefore[p.id] = (eloCol === "squad_elo" ? p.squad_elo : p.competitive_elo) ?? 1000;
  }
  for (const u of participants) {
    if (!(u in eloBefore)) eloBefore[u] = 1000;
  }
  return eloBefore;
}
