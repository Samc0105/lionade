/**
 * POST /api/arena/v2/complete  { matchId }
 *
 * Settle an ASYNC (ghost) duel. The live player is scored from their persisted
 * arena_answers (server-authoritative, same as V1); the ghost is scored from
 * its RECORDED answers using the identical speed-bonus formula so the match is
 * fair. ELO ONLY — no Fang transfer ever touches a ghost duel. The live
 * player's ELO applies immediately; for a REAL ghost the owner is offline, so
 * their symmetric (negated) delta is BUFFERED onto profiles.pending_* and
 * applied on their next login claim (pool conserved). Trainer-ghost matches
 * buffer nothing (the trainer system user is outside the rating pool).
 *
 * Idempotent via an atomic active->completing claim (mirrors V1). Gated behind
 * the Arena V2 flag; the V1 /api/arena/complete refuses is_async matches.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/flag";
import { computeSymmetricGhostElo, type GhostOutcome } from "@/lib/arena-v2/ghost-elo";
import type { GhostAnswer } from "@/lib/arena-v2/ghost-matcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_REACTION_MS = 500;
const PENDING_SUMMARY_CAP = 50;

/** Points for one answer: 10 base + speed bonus, matching /api/arena/answer. */
function scoreAnswer(correct: boolean, timeMs: number, timeLimitS: number): number {
  if (!correct) return 0;
  const limitMs = (timeLimitS || 15) * 1000;
  const clamped = Number.isFinite(timeMs) ? Math.max(MIN_REACTION_MS, Math.min(limitMs, timeMs)) : limitMs;
  const pct = clamped / limitMs;
  let pts = 10;
  if (pct < 0.3) pts += 5;
  else if (pct < 0.5) pts += 3;
  else if (pct < 0.75) pts += 1;
  return pts;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ error: "Arena V2 not enabled" }, { status: 403 });
  }
  const userId = auth.userId;

  let matchId: string;
  try {
    matchId = (await req.json()).matchId;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!matchId) return NextResponse.json({ error: "Missing matchId" }, { status: 400 });

  const { data: match } = await supabaseAdmin
    .from("arena_matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  if (!match.is_async) {
    return NextResponse.json({ error: "Not a ghost match" }, { status: 400 });
  }
  // The live player is player1 on an async match; player2 is the ghost owner.
  if (match.player1_id !== userId) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }
  if (match.status === "completed") {
    return NextResponse.json({ alreadyCompleted: true, match });
  }

  // Atomic claim (active -> completing) so a double-submit settles once.
  const { data: claimed } = await supabaseAdmin
    .from("arena_matches")
    .update({ status: "completing" })
    .eq("id", matchId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    const { data: refetch } = await supabaseAdmin.from("arena_matches").select("*").eq("id", matchId).single();
    return NextResponse.json({ alreadyCompleted: true, match: refetch });
  }

  // Per-question time limits (for the ghost's speed-bonus scoring).
  const { data: mqs } = await supabaseAdmin
    .from("arena_match_questions")
    .select("question_id, time_limit")
    .eq("match_id", matchId);
  const limitByQ = new Map<string, number>((mqs ?? []).map((m) => [m.question_id, m.time_limit ?? 15]));

  // Live player's score from their persisted answers (never trust the client).
  const { data: liveAnswers } = await supabaseAdmin
    .from("arena_answers")
    .select("points_earned, is_correct")
    .eq("match_id", matchId)
    .eq("user_id", userId);
  let livePoints = 0;
  let liveCorrect = 0;
  for (const a of liveAnswers ?? []) {
    livePoints += a.points_earned ?? 0;
    if (a.is_correct) liveCorrect++;
  }

  // Ghost's score, recomputed from its recorded answers with the same formula.
  const { data: ghost } = await supabaseAdmin
    .from("duel_ghosts")
    .select("answers, is_trainer")
    .eq("id", match.ghost_id)
    .maybeSingle();
  const ghostAnswers: GhostAnswer[] = ghost
    ? ((typeof ghost.answers === "string" ? JSON.parse(ghost.answers) : ghost.answers) ?? [])
    : [];
  let ghostPoints = 0;
  for (const ga of ghostAnswers) {
    ghostPoints += scoreAnswer(!!ga.correct, ga.time_ms ?? 0, limitByQ.get(ga.question_id) ?? 15);
  }

  // Outcome from the LIVE player's perspective.
  const outcome: GhostOutcome = livePoints > ghostPoints ? "win" : livePoints < ghostPoints ? "loss" : "draw";
  const liveElo = match.player1_elo_before ?? 1000;
  const ghostElo = match.player2_elo_before ?? 1000;
  const { liveDelta, ghostDelta } = computeSymmetricGhostElo(liveElo, ghostElo, outcome);
  const newLiveElo = liveElo + liveDelta;

  // Finalize the match record (ELO only; no wager/Fangs on async matches).
  await supabaseAdmin
    .from("arena_matches")
    .update({
      status: "completed",
      winner_id: outcome === "win" ? match.player1_id : outcome === "loss" ? match.player2_id : null,
      player1_total_points: livePoints,
      player2_total_points: ghostPoints,
      player1_score: liveCorrect,
      player1_elo_after: newLiveElo,
      completed_at: new Date().toISOString(),
    })
    .eq("id", matchId);

  // Apply the LIVE player's ELO + W/L/D immediately (non-ledger columns).
  const { data: liveProfile } = await supabaseAdmin
    .from("profiles")
    .select("arena_wins, arena_losses, arena_draws")
    .eq("id", userId)
    .single();
  const liveUpd: Record<string, number> = { arena_elo: newLiveElo };
  if (outcome === "win") liveUpd.arena_wins = (liveProfile?.arena_wins ?? 0) + 1;
  else if (outcome === "loss") liveUpd.arena_losses = (liveProfile?.arena_losses ?? 0) + 1;
  else liveUpd.arena_draws = (liveProfile?.arena_draws ?? 0) + 1;
  await supabaseAdmin.from("profiles").update(liveUpd).eq("id", userId);

  // Buffer the ghost OWNER's symmetric delta for their next-login claim — but
  // ONLY for a real ghost. Trainer ghosts are owned by the system user and are
  // excluded from the conserved rating pool, so they buffer nothing.
  if (!match.is_trainer_match && ghost && !ghost.is_trainer) {
    const ownerId = match.player2_id;
    const { data: owner } = await supabaseAdmin
      .from("profiles")
      .select("pending_elo_change, pending_elo_summary, pending_wins, pending_losses, pending_draws")
      .eq("id", ownerId)
      .maybeSingle();
    if (owner) {
      // Owner's outcome is the mirror of the live player's.
      const ownerWon = outcome === "loss";
      const ownerLost = outcome === "win";
      const prevSummary: unknown[] = Array.isArray(owner.pending_elo_summary) ? owner.pending_elo_summary : [];
      const entry = {
        match_id: matchId,
        challenged_at: new Date().toISOString(),
        subject: match.subject ?? null,
        outcome: ownerWon ? "win" : ownerLost ? "loss" : "draw",
        elo_delta: ghostDelta,
      };
      const nextSummary = [...prevSummary, entry].slice(-PENDING_SUMMARY_CAP);
      await supabaseAdmin
        .from("profiles")
        .update({
          pending_elo_change: (owner.pending_elo_change ?? 0) + ghostDelta,
          pending_elo_summary: nextSummary,
          pending_wins: (owner.pending_wins ?? 0) + (ownerWon ? 1 : 0),
          pending_losses: (owner.pending_losses ?? 0) + (ownerLost ? 1 : 0),
          pending_draws: (owner.pending_draws ?? 0) + (!ownerWon && !ownerLost ? 1 : 0),
        })
        .eq("id", ownerId);
    }
  }

  return NextResponse.json({
    outcome,
    live: { points: livePoints, correct: liveCorrect, eloBefore: liveElo, eloAfter: newLiveElo, eloChange: liveDelta },
    ghost: { points: ghostPoints, isTrainer: !!match.is_trainer_match },
  });
}
