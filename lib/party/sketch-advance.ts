// Shared Sketchy Subjects round-completion + scoring.
//
// SINGLE SOURCE OF TRUTH for "close out a drawing round once (drawer reward +
// Fang faucet) and flip it into the celebrating overlay." Callers:
//   - app/api/party/sketch/rounds/[id]/complete/route.ts (POST) — the
//     client-driven fast path (drawer/host timer fires it at 0s).
//   - app/api/party/sketch/rounds/[id]/complete/route.ts (GET) — server-side
//     lazy completion on read: if the drawing deadline (started_at +
//     duration_sec) has passed, complete the round inline. Any client that GETs
//     this route after the deadline self-heals a round whose drawer AND host
//     both have backgrounded (timer-throttled) tabs, which would otherwise
//     freeze the room forever.
//
// Mirrors lib/party/bluff-advance.ts + lib/party/trivia-advance.ts. Why a
// shared helper: completion ADDS the drawer's reward to a running score, so it
// must run exactly once. The transition is a compare-and-swap (UPDATE ...
// WHERE ended_at IS NULL); only the single caller whose CAS actually stamps
// ended_at applies the drawer reward. Even if the client /complete POST and a
// GET lazy-completion race, the DB guarantees one winner — the loser's update
// affects 0 rows and it skips the reward. (The Fang faucet is independently
// idempotent via the sketch_fang_awards unique constraint, so it's safe under a
// re-run regardless, but routing it through the CAS winner keeps it tidy.)

import type { SupabaseClient } from "@supabase/supabase-js";
import { sketchDrawerPoints } from "@/lib/party/scoring";
import { awardSketchFangs } from "@/lib/party/sketch-fangs";
import { sketchDrawerFangs } from "@/lib/party/sketch-economy";

// Fast-guesser bonus window (mirrors the /complete route).
const FAST_GUESS_WINDOW_MS = 30_000;

export interface SketchCompleteResult {
  /** True only when THIS call won the CAS and actually completed the round. */
  completed: boolean;
  /** The phase the round is in after this call ('celebrating' once complete). */
  phase: string;
  /** First correct guesser this round, or null on a timeout (winner of the round). */
  winnerUserId: string | null;
}

interface RoundForComplete {
  id: string;
  room_id: string;
  drawer_user_id: string;
  started_at: string;
  duration_sec: number | null;
  ended_at: string | null;
  phase: string | null;
}

/**
 * Has this drawing round's server deadline (started_at + duration_sec) passed?
 * Returns false for rounds with no start / already ended. Used by the GET lazy
 * path to decide whether to attempt completion at all.
 */
export function isSketchDrawingExpired(round: {
  started_at: string | null;
  duration_sec: number | null;
  ended_at: string | null;
}): boolean {
  if (round.ended_at) return false;
  if (!round.started_at) return false;
  const durMs = (round.duration_sec ?? 90) * 1000;
  return Date.now() >= new Date(round.started_at).getTime() + durMs;
}

/**
 * Complete a sketch round exactly once, CAS-guarded on `ended_at IS NULL`.
 *   - Computes the drawer reward from the persisted correct guesses.
 *   - Applies the reward to the running scoreboard (ONLY if THIS call won).
 *   - Mints the drawer's Fang faucet reward (idempotent regardless).
 *   - Stamps ended_at + phase='celebrating' + winner + celebrating_started_at.
 *
 * Returns whether THIS caller completed it (false if someone already had, or if
 * the CAS lost the race). Safe to call concurrently from the POST + GET paths.
 */
export async function completeSketchRound(
  supabase: SupabaseClient,
  round: RoundForComplete,
): Promise<SketchCompleteResult> {
  if (round.ended_at) {
    return { completed: false, phase: round.phase ?? "celebrating", winnerUserId: null };
  }

  // Count correct guessers + fast guessers (within the first 30s). Order by
  // guessed_at so the FIRST correct guess identifies the round winner.
  const { data: correctGuesses } = await supabase
    .from("sketch_guesses")
    .select("user_id, guessed_at")
    .eq("round_id", round.id)
    .eq("was_correct", true)
    .order("guessed_at", { ascending: true });
  const correctCount = correctGuesses?.length ?? 0;
  const winnerUserId =
    correctGuesses && correctGuesses.length > 0 ? correctGuesses[0].user_id : null;

  const startMs = new Date(round.started_at).getTime();
  const fastCount = (correctGuesses ?? []).filter(
    (g) => new Date(g.guessed_at).getTime() - startMs <= FAST_GUESS_WINDOW_MS,
  ).length;

  const { count: activePlayers } = await supabase
    .from("party_room_players")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", round.room_id)
    .is("left_at", null);
  const guesserDenom = Math.max(1, (activePlayers ?? 1) - 1);
  const fastRatio = fastCount / guesserDenom;
  const drawerReward = sketchDrawerPoints(correctCount, fastRatio);

  // ── CAS: claim the completion. Only the winner stamps ended_at, so only the
  // winner applies the drawer scoreboard reward (a read-modify-write that would
  // double-count if two completes both ran it). ──
  const nowIso = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("sketch_rounds")
    .update({
      ended_at: nowIso,
      phase: "celebrating",
      winner_user_id: winnerUserId,
      celebrating_started_at: nowIso,
    })
    .eq("id", round.id)
    .is("ended_at", null)
    .select("id");
  const wonCas = !!(claimed && claimed.length > 0);

  if (wonCas && drawerReward > 0) {
    const { data: drawerRow } = await supabase
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", round.drawer_user_id)
      .maybeSingle();
    if (drawerRow) {
      await supabase
        .from("party_room_players")
        .update({ score: (drawerRow.score ?? 0) + drawerReward })
        .eq("room_id", round.room_id)
        .eq("user_id", round.drawer_user_id);
    }
  }

  // Fang faucet — idempotent per (round, drawer, reason) via the ledger unique
  // constraint, so it's safe to call even on the CAS loser; routing it through
  // the winner keeps the once-only intent explicit.
  if (wonCas) {
    await awardSketchFangs(supabase, {
      roundId: round.id,
      userId: round.drawer_user_id,
      reason: "drawing",
      fangs: sketchDrawerFangs(correctCount),
    });
  }

  return { completed: wonCas, phase: "celebrating", winnerUserId };
}
