// Shared Bluff Trivia phase-advance + scoring.
//
// SINGLE SOURCE OF TRUTH for "flip a round out of its current phase and (when
// landing on reveal) score it exactly once." Both callers use this:
//   - app/api/party/bluff/rounds/[id]/complete/route.ts  (client-driven fast path)
//   - app/api/party/bluff/rounds/[id]/route.ts (GET)      (server-side lazy
//     advance on read — self-heals a room whose host tab is backgrounded and
//     whose timers are throttled, so any poller unsticks it)
//
// Why a shared helper: scoring ADDS deltas to running scores, so it must run
// exactly once per ->reveal transition. The transition is a compare-and-swap
// (UPDATE ... WHERE phase = <from>); only the single caller whose CAS actually
// flips the row runs scoreRound(). Even if a GET lazy-advance and a client
// complete POST race, the DB guarantees one winner — the loser's update
// affects 0 rows and it skips scoring. Keeping the logic here (not duplicated)
// is what stops the two paths from drifting and double-scoring.

import type { SupabaseClient } from "@supabase/supabase-js";
import { BLUFF_TRUTH_POINTS, BLUFF_FAKE_TRICK_POINTS } from "@/lib/party/scoring";

const DEFAULT_VOTE_SECONDS = 30;

export type BluffPhase = "write" | "vote" | "reveal";

export interface AdvanceResult {
  /** The phase the round is in AFTER this call. */
  phase: string;
  /** True only when THIS call won the CAS and actually flipped the row. */
  advanced: boolean;
  /** Set when a write->vote transition we won established a new vote deadline. */
  vote_ends_at?: string;
}

/**
 * Advance a bluff round out of `fromPhase` by one step, CAS-guarded.
 *   write -> vote   (sets vote_ends_at)
 *   vote  -> reveal (sets ended_at, runs scoreRound exactly once)
 *
 * `voteSeconds` is the room setting (falls back to DEFAULT_VOTE_SECONDS).
 * Returns whether THIS caller won the transition. Safe to call concurrently:
 * the WHERE phase = fromPhase clause means only one racer flips + scores.
 */
export async function advanceBluffPhase(
  supabase: SupabaseClient,
  roundId: string,
  fromPhase: "write" | "vote",
  voteSeconds: number | null | undefined,
): Promise<AdvanceResult> {
  if (fromPhase === "write") {
    const secs = voteSeconds ?? DEFAULT_VOTE_SECONDS;
    const voteEndsAt = new Date(Date.now() + secs * 1000).toISOString();
    const { data: flipped } = await supabase
      .from("bluff_rounds")
      .update({ phase: "vote", vote_ends_at: voteEndsAt })
      .eq("id", roundId)
      .eq("phase", "write")
      .select("id");
    if (flipped && flipped.length > 0) {
      return { phase: "vote", advanced: true, vote_ends_at: voteEndsAt };
    }
    // Lost the race — report whatever the round is now.
    const { data: now } = await supabase
      .from("bluff_rounds")
      .select("phase")
      .eq("id", roundId)
      .maybeSingle();
    return { phase: now?.phase ?? "vote", advanced: false };
  }

  // fromPhase === "vote" -> reveal
  const { data: flipped } = await supabase
    .from("bluff_rounds")
    .update({ phase: "reveal", ended_at: new Date().toISOString() })
    .eq("id", roundId)
    .eq("phase", "vote")
    .select("id");
  if (flipped && flipped.length > 0) {
    // We won the transition — votes are frozen (the vote route rejects when
    // phase != 'vote'), so scoring here is applied exactly once.
    await scoreRound(supabase, roundId);
    return { phase: "reveal", advanced: true };
  }
  return { phase: "reveal", advanced: false };
}

/** Force a round straight to reveal from any non-reveal phase (host "end"
 *  fallback). CAS-guarded; scores exactly once if THIS call wins the flip. */
export async function forceEndBluffRound(
  supabase: SupabaseClient,
  roundId: string,
): Promise<void> {
  const { data: flipped } = await supabase
    .from("bluff_rounds")
    .update({ phase: "reveal", ended_at: new Date().toISOString() })
    .eq("id", roundId)
    .neq("phase", "reveal")
    .select("id");
  if (flipped && flipped.length > 0) {
    await scoreRound(supabase, roundId);
  }
}

/** Compute and persist score deltas for a finished bluff round.
 *  MUST only be called by the single CAS winner of the ->reveal transition —
 *  it adds deltas to running scores, so a second invocation double-counts. */
export async function scoreRound(
  supabase: SupabaseClient,
  roundId: string,
): Promise<void> {
  const { data: round } = await supabase
    .from("bluff_rounds")
    .select("room_id, correct_answer")
    .eq("id", roundId)
    .maybeSingle();
  if (!round) return;

  const { data: answers } = await supabase
    .from("bluff_answers")
    .select("id, user_id, is_truth")
    .eq("round_id", roundId);
  const { data: votes } = await supabase
    .from("bluff_votes")
    .select("answer_id, voter_user_id")
    .eq("round_id", roundId);

  const answerById = new Map<string, { user_id: string; is_truth: boolean }>();
  (answers ?? []).forEach((a) => answerById.set(a.id, { user_id: a.user_id, is_truth: a.is_truth }));

  const deltas: Map<string, number> = new Map();
  (votes ?? []).forEach((v) => {
    const answer = answerById.get(v.answer_id);
    if (!answer) return;
    if (answer.is_truth) {
      // Voter picked the truth → +1000 for voter.
      deltas.set(v.voter_user_id, (deltas.get(v.voter_user_id) ?? 0) + BLUFF_TRUTH_POINTS);
    } else {
      // Voter picked a fake → +500 for the fake's author (the bluffer).
      deltas.set(answer.user_id, (deltas.get(answer.user_id) ?? 0) + BLUFF_FAKE_TRICK_POINTS);
    }
  });

  // Apply deltas to party_room_players.
  const entries = Array.from(deltas.entries());
  for (const [uid, delta] of entries) {
    if (delta === 0) continue;
    const { data: row } = await supabase
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (!row) continue;
    await supabase
      .from("party_room_players")
      .update({ score: (row.score ?? 0) + delta })
      .eq("room_id", round.room_id)
      .eq("user_id", uid);
  }
}
