// Arena V2 — complete an async duel.
//
// POST body: { matchId: string }
//
// Behavior (gated):
//   1. Verify the user is player1 (the live player) of an async V2 match.
//   2. Atomic claim status='active' → 'completing' (V1 race-window trick).
//   3. Compute final scores from arena_answers (live player) vs. the ghost's
//      recorded answers (already saved on duel_ghosts.total_score). Apply
//      Q8-10 1.5x comeback multiplier (applied at points, not stake).
//   4. ELO update for live player immediately. Ghost owner gets a symmetric
//      offline buffer on profiles.pending_elo_change (Phase 3 — see ELO
//      conservation block below). Zero passive Fang earn for the ghost
//      owner is unchanged.
//   5. Fang transfer: winner takes full stake (winner gets +stake, loser
//      loses -stake). Trainer-Ninny matches: no Fang movement, free
//      practice. Mismatched-duel (gap >300): stake was already halved at
//      queue time, so we just transfer what's on the row.
//   6. Loss-cap enforcement: if user's net 24h Fang loss BEFORE this
//      match was already at/below the tier cap, do NOT debit further on
//      a loss. (We don't refund Fangs — we just stop the bleeding.)
//   7. 3-loss streak: if this loss makes a fresh 3-streak, dispense +25F
//      shake-it-off gift (one per 24h) and set a flag on the response.
//   8. Record a `duel_ghosts` row for the live player's run, but only if
//      profiles.ghost_consent_at IS NOT NULL.
//
// ── ELO conservation (Option B — buffered ghost-owner update) ──────
//
// Each real-ghost match generates a symmetric +/- ELO flow so the rating
// pool stays conserved across the population. We CANNOT write the ghost
// owner's arena_elo directly because they're offline and would never see
// the change happen. Instead we buffer on the ghost owner's profile:
//
//   profiles.pending_elo_change   int      — accumulating signed sum
//   profiles.pending_elo_summary  jsonb    — per-match audit entries
//   profiles.pending_wins         int      — increment for arena_wins
//   profiles.pending_losses       int      — increment for arena_losses
//   profiles.pending_draws        int      — increment for arena_draws
//
// On the ghost owner's next login the V2 lobby shows a Claim card and
// POST /api/arena/v2/claim-ghost-elo applies + zeroes the buffer.
//
// Summary array shape (one entry per match the user's ghost was hit):
//   {
//     "match_id": "uuid",
//     "challenged_at": "2026-05-26T22:00:00.000Z",
//     "challenger_anon_handle": "Shadow Wolf 4729",
//     "subject": "algebra",
//     "outcome": "ghost_won" | "ghost_lost" | "draw",
//     "elo_delta": 4
//   }
//
// The summary array is FIFO-capped at 50 entries here to bound JSONB row
// size for users who go away for a long time. The /summary endpoint and
// the Claim card both expect this cap.
//
// TRAINER NINNY matches DO NOT touch the trainer profile's pending buffer.
// Trainer ghosts inject/absorb ELO from outside the player pool by design
// (see project_arena_v2_decisions.md "ELO conservation"). The per-user
// trainer cap (first 3 duels OR 24h) bounds the imbalance.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/feature-flag";
import { generateAnonHandle } from "@/lib/arena-v2/anon-handle";
import {
  resolveLossCapTier,
  computeLossWindow,
  isLossCapReached,
} from "@/lib/arena-v2/loss-cap";

const GHOST_SUMMARY_CAP = 50;

interface GhostSummaryEntry {
  match_id: string;
  challenged_at: string;
  challenger_anon_handle: string;
  subject: string;
  outcome: "ghost_won" | "ghost_lost" | "draw";
  elo_delta: number;
}

const COMEBACK_QUESTIONS = new Set([7, 8, 9]); // zero-indexed Q8/9/10
const COMEBACK_MULTIPLIER = 1.5;
const SHAKE_IT_OFF_FANGS = 25;

export async function POST(req: NextRequest) {
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ error: "Arena V2 disabled" }, { status: 404 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { matchId } = await req.json();
    if (!matchId) {
      return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
    }

    const { data: match } = await supabaseAdmin
      .from("arena_matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (!match.is_async) {
      return NextResponse.json({ error: "Not a V2 async match" }, { status: 400 });
    }
    if (match.player1_id !== userId) {
      return NextResponse.json({ error: "Not the live player" }, { status: 403 });
    }
    if (match.status === "completed") {
      return NextResponse.json({ alreadyCompleted: true, match });
    }

    // Atomic claim — V1 trick to avoid double-complete.
    const { data: claimed } = await supabaseAdmin
      .from("arena_matches")
      .update({ status: "completing" })
      .eq("id", matchId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      const { data: refetch } = await supabaseAdmin
        .from("arena_matches")
        .select("*")
        .eq("id", matchId)
        .single();
      return NextResponse.json({ alreadyCompleted: true, match: refetch });
    }

    // Live player's recorded answers.
    const { data: liveAnswers } = await supabaseAdmin
      .from("arena_answers")
      .select("question_id, selected_answer, is_correct, response_time_ms, points_earned")
      .eq("match_id", matchId)
      .eq("user_id", userId);

    // Ghost data — both players' question-by-question performance to compute
    // who "won" via HP-bar logic. For Phase 1 we keep V1's score-based
    // winner heuristic but apply the 1.5x comeback multiplier on Qs 8-10.
    // owner_user_id is needed for the Phase 3 ghost-owner ELO buffer.
    const { data: ghost } = await supabaseAdmin
      .from("duel_ghosts")
      .select("answers, total_score, owner_user_id")
      .eq("id", match.ghost_id)
      .single();

    const ghostAnswers = (ghost?.answers ?? []) as Array<{
      question_id: string;
      selected_index: number;
      time_ms: number;
      correct: boolean;
    }>;

    const questionIds: string[] = match.question_ids ?? [];
    let livePoints = 0;
    let liveCorrect = 0;
    let ghostPoints = 0;
    let ghostCorrect = 0;

    for (let i = 0; i < questionIds.length; i++) {
      const qid = questionIds[i];
      const mult = COMEBACK_QUESTIONS.has(i) ? COMEBACK_MULTIPLIER : 1;

      const la = liveAnswers?.find((a) => a.question_id === qid);
      if (la?.is_correct) {
        livePoints += Math.round((la.points_earned || 100) * mult);
        liveCorrect++;
      }

      const ga = ghostAnswers.find((a) => a.question_id === qid);
      if (ga?.correct) {
        // Phase 1: each ghost-correct = base 100 points * mult. Phase 2
        // can mirror the live player's speed-bonus curve once we move
        // points calc into a shared lib.
        ghostPoints += Math.round(100 * mult);
        ghostCorrect++;
      }
    }

    // Winner determination — points only in Phase 1. HP-bar logic ships
    // with the UI in Phase 2; the underlying total_score comparison is
    // equivalent (more correct → more damage → more HP remaining).
    let winnerId: string | null = null;
    if (livePoints > ghostPoints) winnerId = match.player1_id;
    else if (ghostPoints > livePoints) winnerId = match.player2_id;

    // ELO update — live player gets their delta immediately. Ghost owner's
    // delta is computed symmetric (-1 × live delta) and BUFFERED on their
    // profile for next-login claim. See doc-comment at top of file.
    const liveEloBefore = match.player1_elo_before ?? 1000;
    const ghostEloBefore = match.player2_elo_before ?? 1000;
    const K = 32;
    const expectedLive = 1 / (1 + Math.pow(10, (ghostEloBefore - liveEloBefore) / 400));
    const actualLive = winnerId === userId ? 1 : winnerId === null ? 0.5 : 0;
    const newLiveElo = Math.round(liveEloBefore + K * (actualLive - expectedLive));
    const liveEloDelta = newLiveElo - liveEloBefore;
    // Symmetric ghost-owner delta. Pool conservation: live gain == ghost loss.
    const ghostOwnerEloDelta = -liveEloDelta;

    // Fang transfer — guarded by loss cap + trainer match flag.
    const { data: liveProfile } = await supabaseAdmin
      .from("profiles")
      .select("coins, arena_wins, arena_losses, arena_draws, plan, ghost_consent_at, last_shake_it_off_at")
      .eq("id", userId)
      .single();

    const isPro = liveProfile?.plan === "pro";
    const tier = resolveLossCapTier({ elo: liveEloBefore, isPro });
    const lossWindow = await computeLossWindow(supabaseAdmin, userId);
    const capAlreadyReached = isLossCapReached({
      netFangsLast24h: lossWindow.netFangsLast24h,
      tier,
    });

    let fangsDelta = 0;
    if (!match.is_trainer_match) {
      if (winnerId === userId) fangsDelta = match.wager;
      else if (winnerId === match.player2_id) {
        // Loss — only debit if cap not already reached.
        fangsDelta = capAlreadyReached ? 0 : -match.wager;
      }
      // Draws: no transfer.
    }

    const newCoins = Math.max(0, (liveProfile?.coins ?? 0) + fangsDelta);

    // 3-loss streak intervention.
    const isFreshLoss = winnerId && winnerId !== userId && !match.is_trainer_match;
    const willHit3Streak = isFreshLoss && lossWindow.currentLossStreak + 1 >= 3;
    const lastShake = liveProfile?.last_shake_it_off_at
      ? new Date(liveProfile.last_shake_it_off_at).getTime()
      : 0;
    const shakeOnCooldown = Date.now() - lastShake < 24 * 60 * 60 * 1000;
    const dispenseShakeItOff = willHit3Streak && !shakeOnCooldown;

    const profileUpdates: Record<string, unknown> = {
      arena_elo: newLiveElo,
      coins: newCoins + (dispenseShakeItOff ? SHAKE_IT_OFF_FANGS : 0),
    };
    if (winnerId === userId) profileUpdates.arena_wins = (liveProfile?.arena_wins ?? 0) + 1;
    else if (winnerId === null) profileUpdates.arena_draws = (liveProfile?.arena_draws ?? 0) + 1;
    else if (!match.is_trainer_match) profileUpdates.arena_losses = (liveProfile?.arena_losses ?? 0) + 1;
    if (dispenseShakeItOff) profileUpdates.last_shake_it_off_at = new Date().toISOString();

    await supabaseAdmin.from("profiles").update(profileUpdates).eq("id", userId);

    // ── Ghost-owner offline ELO buffer (Phase 3) ────────────────────
    // Apply ONLY for real-ghost matches: skip trainer matches (trainer
    // ghosts are outside the conservation pool) and skip if there's no
    // ghost row or the ghost belongs to the live player somehow (the
    // matcher should never serve a player their own ghost, but we guard).
    if (
      match.is_async === true &&
      match.is_trainer_match === false &&
      ghost?.owner_user_id &&
      ghost.owner_user_id !== userId
    ) {
      const ghostOwnerId = ghost.owner_user_id as string;
      const { data: ownerRow } = await supabaseAdmin
        .from("profiles")
        .select("pending_elo_change, pending_elo_summary, pending_wins, pending_losses, pending_draws")
        .eq("id", ghostOwnerId)
        .single();

      // Live winner == ghost loser, and vice versa. Draws go in their own bucket.
      const ghostOutcome: GhostSummaryEntry["outcome"] =
        winnerId === null
          ? "draw"
          : winnerId === userId
            ? "ghost_lost"
            : "ghost_won";

      const entry: GhostSummaryEntry = {
        match_id: matchId,
        challenged_at: new Date().toISOString(),
        challenger_anon_handle: generateAnonHandle(userId),
        subject: (match.subject ?? "general") as string,
        outcome: ghostOutcome,
        elo_delta: ghostOwnerEloDelta,
      };

      const prevSummary = (ownerRow?.pending_elo_summary ?? []) as GhostSummaryEntry[];
      // FIFO cap at GHOST_SUMMARY_CAP — newest entries are pushed to the end,
      // and we keep the trailing window of recent entries.
      const nextSummary = [...prevSummary, entry].slice(-GHOST_SUMMARY_CAP);

      const ownerUpdates: Record<string, unknown> = {
        pending_elo_change: (ownerRow?.pending_elo_change ?? 0) + ghostOwnerEloDelta,
        pending_elo_summary: nextSummary,
      };
      if (ghostOutcome === "ghost_won") {
        ownerUpdates.pending_wins = (ownerRow?.pending_wins ?? 0) + 1;
      } else if (ghostOutcome === "ghost_lost") {
        ownerUpdates.pending_losses = (ownerRow?.pending_losses ?? 0) + 1;
      } else {
        ownerUpdates.pending_draws = (ownerRow?.pending_draws ?? 0) + 1;
      }

      const { error: ownerErr } = await supabaseAdmin
        .from("profiles")
        .update(ownerUpdates)
        .eq("id", ghostOwnerId);
      if (ownerErr) {
        // Log only — never fail the live player's complete because the
        // owner-buffer write hiccuped. The next match against the same
        // ghost will still pile its own entry on top.
        console.error("[arena/v2/complete] ghost-owner buffer update failed", ownerErr);
      }
    }

    // Finalize match row.
    await supabaseAdmin
      .from("arena_matches")
      .update({
        status: "completed",
        winner_id: winnerId,
        player1_total_points: livePoints,
        player2_total_points: ghostPoints,
        player1_score: liveCorrect,
        player2_score: ghostCorrect,
        player1_elo_after: newLiveElo,
        player2_elo_after: ghostEloBefore, // ghost owner ELO untouched
        completed_at: new Date().toISOString(),
      })
      .eq("id", matchId);

    // Record live player as a NEW ghost — but only with consent.
    let recordedGhostId: string | null = null;
    if (liveProfile?.ghost_consent_at) {
      const ghostAnswerPayload = (liveAnswers ?? []).map((a) => ({
        question_id: a.question_id,
        selected_index: a.selected_answer ?? -1,
        time_ms: a.response_time_ms ?? 15000,
        correct: a.is_correct,
      }));
      const { data: newGhost } = await supabaseAdmin
        .from("duel_ghosts")
        .insert({
          owner_user_id: userId,
          subject: match.subject ?? "general",
          elo_at_recording: liveEloBefore,
          question_ids: questionIds,
          answers: ghostAnswerPayload,
          total_score: livePoints,
          is_trainer: false,
        })
        .select("id")
        .single();
      recordedGhostId = newGhost?.id ?? null;
    }

    return NextResponse.json({
      matchId,
      winnerId,
      livePoints,
      ghostPoints,
      newLiveElo,
      fangsDelta: dispenseShakeItOff ? fangsDelta + SHAKE_IT_OFF_FANGS : fangsDelta,
      capAlreadyReached,
      lossCap: tier,
      shakeItOffDispensed: dispenseShakeItOff,
      recordedGhostId,
      isTrainerMatch: match.is_trainer_match,
    });
  } catch (e) {
    console.error("[arena/v2/complete]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
