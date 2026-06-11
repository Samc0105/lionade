// Shared Trivia (Lightning Round) phase-advance + scoring.
//
// SINGLE SOURCE OF TRUTH for "flip a round out of its current phase and (when
// landing on reveal) score it exactly once." Both callers use this:
//   - app/api/party/trivia/rounds/[id]/complete/route.ts  (client-driven fast path)
//   - app/api/party/trivia/rounds/[id]/route.ts (GET)      (server-side lazy
//     advance on read — self-heals a room whose host tab is backgrounded and
//     whose timers are throttled, so any poller unsticks it)
//
// Mirrors lib/party/bluff-advance.ts. Why a shared helper: scoring ADDS deltas
// to running scores, so it must run exactly once per ->reveal transition. The
// transition is a compare-and-swap (UPDATE ... WHERE phase = <from>); only the
// single caller whose CAS actually flips the row runs scoreRound(). Even if a
// GET lazy-advance and a client complete POST race, the DB guarantees one
// winner — the loser's update affects 0 rows and it skips scoring.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRIVIA_BASE_POINTS,
  TRIVIA_MAX_SPEED_POINTS,
  TRIVIA_STREAK_STEP_POINTS,
  TRIVIA_STREAK_MAX_STEPS,
} from "@/lib/party/scoring";

const DEFAULT_REVEAL_SECONDS = 6;
const DEFAULT_ANSWER_SECONDS = 12;
// Mirrors the round-create pad: clients show a RoundCountdown overlay before the
// answer window opens, so answer_ends_at = started_at + (PAD + answer)*1000.
// We subtract the pad back out when measuring the original answer window for
// speed scoring.
const COUNTDOWN_PAD_SECONDS = 5;

// ── Shared, single-source helpers (used by scoreRound here + the GET reveal
// handler + the create/complete routes). Keeping these in one place is what
// guarantees the displayed breakdown chips sum to the banked points_earned: if
// the formula ever changes it changes for both the scorer and the renderer. ──

/**
 * Public option shape for any answer-phase-safe payload: index-keyed { id, text }
 * objects, NEVER the secret correct_index. Was copy-pasted across 3 trivia route
 * files; centralized here so the shape can't drift.
 */
export function publicOptions(options: unknown): { id: string; text: string }[] {
  const arr = Array.isArray(options) ? (options as string[]) : [];
  return arr.map((text, i) => ({ id: String(i), text }));
}

/**
 * For each player in a room, count their consecutive correct answers in the
 * PRIOR rounds (round_num < roundNum), walking newest->oldest until a wrong or
 * missing answer breaks the chain. Returns user_id -> prior consecutive-correct
 * count. A round the player didn't answer also breaks the chain (intended).
 *
 * Shared verbatim by scoreRound (to compute the streak bonus) and the GET reveal
 * handler (to reconstruct the streak chip), so they can never disagree.
 */
export async function loadPriorStreak(
  supabase: SupabaseClient,
  roomId: string,
  roundNum: number,
): Promise<Map<string, number>> {
  const priorStreak = new Map<string, number>();
  if (roundNum <= 1) return priorStreak;

  const { data: priorRounds } = await supabase
    .from("trivia_rounds")
    .select("id, round_num, correct_index")
    .eq("room_id", roomId)
    .lt("round_num", roundNum)
    .order("round_num", { ascending: false });
  const priorRoundList = (priorRounds ?? []) as {
    id: string;
    round_num: number;
    correct_index: number;
  }[];
  if (priorRoundList.length === 0) return priorStreak;

  const priorRoundById = new Map(priorRoundList.map((r) => [r.id, r]));
  const { data: priorAnswers } = await supabase
    .from("trivia_answers")
    .select("round_id, user_id, choice_index")
    .in(
      "round_id",
      priorRoundList.map((r) => r.id),
    );
  // user_id -> (round_num -> wasCorrect)
  const correctByUserRound = new Map<string, Map<number, boolean>>();
  (priorAnswers ?? []).forEach((a) => {
    const pr = priorRoundById.get(a.round_id as string);
    if (!pr) return;
    const uid = a.user_id as string;
    if (!correctByUserRound.has(uid)) correctByUserRound.set(uid, new Map());
    correctByUserRound.get(uid)!.set(pr.round_num, a.choice_index === pr.correct_index);
  });
  // priorRoundList is descending — walk from the round just before this one
  // downward; stop at the first round where the user was wrong or has no answer.
  for (const [uid, byRound] of Array.from(correctByUserRound.entries())) {
    let count = 0;
    for (const pr of priorRoundList) {
      if (byRound.get(pr.round_num) === true) count += 1;
      else break;
    }
    priorStreak.set(uid, count);
  }
  return priorStreak;
}

export interface TriviaBreakdown {
  base: number;
  speed: number;
  streak: number;
  correct: boolean;
  streak_count: number;
  points: number;
}

/**
 * The canonical base/speed/streak scoring formula for one player's answer.
 * Shared by scoreRound (to bank points_earned) and the GET reveal handler (to
 * reconstruct the display chips). `priorStreakCount` is this player's prior
 * consecutive-correct count from loadPriorStreak (0 if none).
 */
export function computeTriviaBreakdown(args: {
  isCorrect: boolean;
  answeredAtMs: number;
  answerEndsAtMs: number;
  windowMs: number;
  priorStreakCount: number;
}): TriviaBreakdown {
  const { isCorrect, answeredAtMs, answerEndsAtMs, windowMs, priorStreakCount } = args;
  if (!isCorrect) {
    return { base: 0, speed: 0, streak: 0, correct: false, streak_count: 0, points: 0 };
  }
  const base = TRIVIA_BASE_POINTS;

  // Speed: fraction of the answer window still left when they locked in.
  const timeLeftMs = Math.max(0, answerEndsAtMs - answeredAtMs);
  const speedFrac = Math.min(1, Math.max(0, timeLeftMs / windowMs));
  const speed = Math.round(TRIVIA_MAX_SPEED_POINTS * speedFrac);

  // Streak: this correct answer extends the prior chain by 1.
  const streakCount = priorStreakCount + 1;
  const streak =
    streakCount >= 2
      ? Math.min(streakCount - 1, TRIVIA_STREAK_MAX_STEPS) * TRIVIA_STREAK_STEP_POINTS
      : 0;

  return {
    base,
    speed,
    streak,
    correct: true,
    streak_count: streakCount,
    points: base + speed + streak,
  };
}

/**
 * Derive the ORIGINAL answer-window length (ms) used for speed scoring, backing
 * out the countdown pad. Floors at a minimum so a corrupt/missing timestamp can't
 * blow up speedFrac or divide-by-zero. Shared by scoreRound + the GET handler.
 */
export function triviaWindowMs(
  startedAt: string | null,
  answerEndsAt: string | null,
): number {
  let windowMs = DEFAULT_ANSWER_SECONDS * 1000;
  if (startedAt && answerEndsAt) {
    const raw =
      new Date(answerEndsAt).getTime() -
      new Date(startedAt).getTime() -
      COUNTDOWN_PAD_SECONDS * 1000;
    if (raw > 1000) windowMs = raw;
  }
  return windowMs;
}

export interface TriviaAdvanceResult {
  /** The phase the round is in AFTER this call. */
  phase: string;
  /** True only when THIS call won the CAS and actually flipped the row. */
  advanced: boolean;
  /** Set when an answer->reveal transition we won established a reveal deadline. */
  reveal_ends_at?: string;
}

/**
 * Advance a trivia round out of `fromPhase` by one step, CAS-guarded.
 *   answer -> reveal (sets reveal_ends_at, runs scoreRound exactly once)
 *   reveal -> ended  (sets ended_at; reveal is terminal for the round)
 *
 * `revealSeconds` is the room setting (falls back to DEFAULT_REVEAL_SECONDS).
 * Returns whether THIS caller won the transition. Safe to call concurrently:
 * the WHERE phase = fromPhase clause means only one racer flips + scores.
 */
export async function advanceTriviaPhase(
  supabase: SupabaseClient,
  roundId: string,
  fromPhase: "answer" | "reveal",
  revealSeconds: number | null | undefined,
): Promise<TriviaAdvanceResult> {
  if (fromPhase === "answer") {
    const secs = revealSeconds ?? DEFAULT_REVEAL_SECONDS;
    const revealEndsAt = new Date(Date.now() + secs * 1000).toISOString();
    const { data: flipped } = await supabase
      .from("trivia_rounds")
      .update({ phase: "reveal", reveal_ends_at: revealEndsAt })
      .eq("id", roundId)
      .eq("phase", "answer")
      .select("id");
    if (flipped && flipped.length > 0) {
      // We won the flip — answers are frozen (the answer route rejects when
      // phase != 'answer' or the deadline passed), so scoring runs once.
      await scoreRound(supabase, roundId);
      return { phase: "reveal", advanced: true, reveal_ends_at: revealEndsAt };
    }
    // Lost the race — report whatever the round is now.
    const { data: now } = await supabase
      .from("trivia_rounds")
      .select("phase")
      .eq("id", roundId)
      .maybeSingle();
    return { phase: now?.phase ?? "reveal", advanced: false };
  }

  // fromPhase === "reveal" -> ended. Reveal is terminal: the next round is a new
  // row, so we only stamp ended_at (no further scoring).
  const { data: flipped } = await supabase
    .from("trivia_rounds")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", roundId)
    .eq("phase", "reveal")
    .is("ended_at", null)
    .select("id");
  return { phase: "reveal", advanced: !!(flipped && flipped.length > 0) };
}

interface RoundForScore {
  room_id: string;
  round_num: number;
  correct_index: number;
  started_at: string | null;
  answer_ends_at: string | null;
}

/** Compute and persist score deltas for a finished trivia round.
 *  MUST only be called by the single CAS winner of the answer->reveal
 *  transition — it ADDS deltas to running scores, so a second invocation would
 *  double-count. The CAS guard in advanceTriviaPhase enforces this. */
export async function scoreRound(
  supabase: SupabaseClient,
  roundId: string,
): Promise<void> {
  const { data: round } = await supabase
    .from("trivia_rounds")
    .select("room_id, round_num, correct_index, started_at, answer_ends_at")
    .eq("id", roundId)
    .maybeSingle<RoundForScore>();
  if (!round) return;

  const { data: answers } = await supabase
    .from("trivia_answers")
    .select("user_id, choice_index, answered_at")
    .eq("round_id", roundId);

  // Derive the ORIGINAL answer window length W (ms) for speed scoring. We
  // measure against the original window — answer_ends_at - started_at - PAD —
  // NOT a possibly-early-advance-shortened deadline. If the answer route's
  // "everyone's in" early-advance moved answer_ends_at earlier, this recomputes
  // a window that is shorter than the original by the same amount for everyone,
  // which compresses speed scores equally; that's acceptable and intentional.
  const windowMs = triviaWindowMs(round.started_at, round.answer_ends_at);

  // ── Streak lookup (shared helper — same reconstruction the GET reveal uses) ──
  const priorStreak = await loadPriorStreak(supabase, round.room_id, round.round_num);

  // ── Per-answer scoring + score increments ──
  for (const a of answers ?? []) {
    const uid = a.user_id as string;
    const isCorrect = a.choice_index === round.correct_index;

    const answeredAtMs = a.answered_at ? new Date(a.answered_at).getTime() : 0;
    const answerEndsAtMs = round.answer_ends_at
      ? new Date(round.answer_ends_at).getTime()
      : answeredAtMs;
    const { points } = computeTriviaBreakdown({
      isCorrect,
      answeredAtMs,
      answerEndsAtMs,
      windowMs,
      priorStreakCount: priorStreak.get(uid) ?? 0,
    });

    // Persist per-answer result (is_correct + points_earned).
    await supabase
      .from("trivia_answers")
      .update({ is_correct: isCorrect, points_earned: points })
      .eq("round_id", roundId)
      .eq("user_id", uid);

    // Increment the running scoreboard. Mirrors bluff scoreRound: read the
    // current score then write the sum (no atomic increment helper in use
    // elsewhere; scoring runs once per round under the CAS guard so this
    // read-modify-write is safe from double-application).
    if (points > 0) {
      const { data: row } = await supabase
        .from("party_room_players")
        .select("score")
        .eq("room_id", round.room_id)
        .eq("user_id", uid)
        .maybeSingle();
      if (row) {
        await supabase
          .from("party_room_players")
          .update({ score: (row.score ?? 0) + points })
          .eq("room_id", round.room_id)
          .eq("user_id", uid);
      }
    }
  }
  // Players with NO answer row score 0 and their streak resets naturally on the
  // next round (no prior-round answer = chain broken), so nothing to do here.
}
