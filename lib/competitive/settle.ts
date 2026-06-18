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

/** PostgREST surfaces a missing RPC as PGRST202; raw Postgres as 42883. Used so
 * settle is safe to run before migration 20260618130000 is applied. */
function isMissingFn(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return (
    e.code === "PGRST202" ||
    e.code === "42883" ||
    (typeof e.message === "string" &&
      (e.message.includes("settle_competitive_credit") ||
        e.message.toLowerCase().includes("could not find the function") ||
        e.message.toLowerCase().includes("does not exist")))
  );
}

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

  // ── Per-user ATOMIC settle (credit + ELO), idempotent + concurrency-safe ──
  // settle MUST be safe to run twice: the active|completing claim in /complete +
  // /forfeit is now RESUMABLE (a partial first run that threw after crediting
  // some users can be re-grabbed), and two settlers can race. The dedup key is a
  // competitive_match ledger row per (user_id, reference_id=match.id), enforced
  // by a partial UNIQUE index. settle_competitive_credit inserts that marker
  // ON CONFLICT DO NOTHING and, ONLY if it inserted, applies the cashable
  // balance delta (clamped >=0) — all in ONE transaction, so the marker and the
  // credit can never diverge and a duplicate/concurrent settle is a no-op. It
  // returns whether THIS call credited; if not (already settled), we ALSO skip
  // the ELO write — ELO is an absolute SET to eloAfter[u] recomputed from the
  // now-moved live rating, so re-SETting it would corrupt the rating. A marker
  // is written for EVERY participant (incl. draw / loss-capped / floored-to-0),
  // so a delta-0 user is still deduped and their ELO is not re-SET on a resume.
  // Prior marker amounts feed the terminal row's fang_delta for skipped users.
  //
  // Fang accounting: source 'cashable' for both signs — a win credits cashable,
  // a loss debits cashable WITHOUT touching lifetime_fangs_spent (a wager loss
  // is not a cash-out "spend"); the RPC clamps cashable at 0. ELO is a separate,
  // non-ledger column written plainly only by the call that won the marker.
  const { data: priorTxns } = await supabase
    .from("coin_transactions")
    .select("user_id, amount")
    .eq("type", "competitive_match")
    .eq("reference_id", match.id);
  const priorAmountByUser: Record<string, number> = {};
  for (const t of (priorTxns ?? []) as Array<{ user_id: string; amount: number | null }>) {
    priorAmountByUser[t.user_id] = (priorAmountByUser[t.user_id] ?? 0) + (t.amount ?? 0);
  }

  const profileWrites: Array<Promise<void>> = [];
  const cappedFangDelta: Record<string, number> = {};

  for (const u of participants) {
    profileWrites.push(
      (async () => {
        // Loss-cap a negative wager delta (per user, 24h window).
        let delta = fangDelta[u];
        if (delta < 0) {
          const tier = resolveLossCapTier({ elo: eloBefore[u], isPro: planMap[u] === "pro" });
          const lossWindow = await computeLossWindow(supabase, u);
          if (isLossCapReached({ netFangsLast24h: lossWindow.netFangsLast24h, tier })) delta = 0;
        }
        const label =
          winnerTeam === "draw"
            ? "draw"
            : (winnerTeam === "a") === match.team_a.includes(u)
            ? "win"
            : "loss";
        const description = `Competitive ${label} (${match.mode})`;

        // Atomic claim + credit: marker insert ON CONFLICT DO NOTHING, balance
        // applied only if inserted, all one txn. Returns { credited, effective }.
        const { data: res, error: rpcErr } = await supabase.rpc("settle_competitive_credit", {
          p_user_id: u,
          p_match_id: match.id,
          p_delta: delta,
          p_description: description,
        });

        if (rpcErr && isMissingFn(rpcErr)) {
          // Migration 20260618130000 not applied yet — fall back to the prior
          // best-effort path so this is safe to merge before the RPC exists.
          // (Apply that migration BEFORE relying on resumable-CAS idempotency.)
          if (u in priorAmountByUser) {
            cappedFangDelta[u] = priorAmountByUser[u];
            return;
          }
          const newCoins = Math.max(0, coinsBefore[u] + delta);
          const eff = newCoins - coinsBefore[u];
          cappedFangDelta[u] = eff;
          if (eff !== 0) {
            const { error: coinErr } = await supabase.rpc("update_user_coins", {
              p_user_id: u, p_delta: eff, p_min_balance: 0, p_source: "cashable",
            });
            if (coinErr) console.error("[settle] coin write", u, coinErr.message);
            const { error: txnErr } = await supabase.from("coin_transactions").insert({
              user_id: u, amount: eff, type: "competitive_match",
              reference_id: match.id, description,
            });
            if (txnErr) console.error("[settle] ledger log", u, txnErr.message);
          }
          const { error: eloErr } = await supabase
            .from("profiles").update({ [eloCol]: eloAfter[u] }).eq("id", u);
          if (eloErr) console.error("[settle] elo write", u, eloErr.message);
          return;
        }

        if (rpcErr) {
          // RPC exists but errored — it is transactional, so it rolled back and
          // credited nothing. Fail CLOSED: do NOT write ELO (no credit happened).
          console.error("[settle] credit rpc", u, rpcErr.message);
          cappedFangDelta[u] = priorAmountByUser[u] ?? 0;
          return;
        }

        if (!res?.credited) {
          // Already settled (prior partial run / concurrent settler) — skip ELO.
          cappedFangDelta[u] = priorAmountByUser[u] ?? match.fang_delta?.[u] ?? 0;
          return;
        }
        cappedFangDelta[u] = Number(res.effective ?? 0);
        // We won the marker → write ELO exactly once for this user.
        const { error: eloErr } = await supabase
          .from("profiles").update({ [eloCol]: eloAfter[u] }).eq("id", u);
        if (eloErr) console.error("[settle] elo write", u, eloErr.message);
      })(),
    );
  }

  await Promise.all(profileWrites);

  const finalStatus: "completed" | "forfeited" = opts.forfeitedBy ? "forfeited" : "completed";

  // Terminal-row write — an absolute SET keyed by id, naturally idempotent. NOTE:
  // on the rare RESUME path (a credited user was skipped above) the elo_before/
  // elo_after jsonb for those users is recomputed from the already-moved live
  // rating, so the AUDIT jsonb can drift slightly for them. This is record-only
  // drift: the live ratings + Fang balances are correct (those writes were
  // skipped). fang_delta uses the previously-applied amount for skipped users.
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
