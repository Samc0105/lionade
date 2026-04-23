/**
 * Mastery Mode — BKT math.
 *
 * Pure functions, no side effects, no DB. Imported by any route that updates
 * or reads progress. The server is the only place these run (client never
 * derives mastery — it reads the server-computed value).
 *
 * The model is classic Bayesian Knowledge Tracing with four parameters:
 *   pL0 — prior P(already mastered) before any evidence
 *   pT  — P(learns this turn after one more item)
 *   pS  — P(slips: knew it but answered wrong)
 *   pG  — P(guesses: didn't know it but answered right)
 *
 * Slip/guess are difficulty-tuned: hard questions give stronger signal
 * (harder to guess, easier to slip).
 */

// BKT parameters tuned for professional/specialty certification exams where
// mastery is a LONG-TERM commitment. Previous tuning let pMastery jump from
// 0.10 → 0.34 on the first correct answer; users felt like they were
// "mastering" a cert in 30 minutes. This set pushes harder on pS (more
// likely to slip even if you know it) and pT (slower "learned a bit more"
// transition), so each correct answer barely nudges the needle.
export const BKT = {
  pL0: 0.10,
  pT:  0.03,
  pS:  0.15,
  pG:  0.28,
} as const;

export type Difficulty = "easy" | "medium" | "hard";

function tunedParams(d: Difficulty): { pS: number; pG: number } {
  // Easy questions give weaker positive signal (high pG), stronger negative
  // signal (low pS). Hard questions are the opposite. Numbers widened from
  // the previous tuning to slow mastery climb on easy/medium.
  if (d === "easy")  return { pS: 0.10, pG: 0.40 };
  if (d === "hard")  return { pS: 0.20, pG: 0.16 };
  return { pS: BKT.pS, pG: BKT.pG };
}

/**
 * Classic BKT posterior update. Given a prior pMastery and a correctness
 * observation, return the posterior pMastery. Clamped to [0.02, 0.98] to
 * avoid a pathological 0 or 1 that locks the model.
 */
export function updateBKT(
  pMastery: number,
  correct: boolean,
  difficulty: Difficulty = "medium",
): number {
  const { pS, pG } = tunedParams(difficulty);

  const pCorrectGivenMastered = 1 - pS;
  const pCorrectGivenNotMastered = pG;

  let pMasteredGivenObs: number;
  if (correct) {
    const pCorrect =
      pMastery * pCorrectGivenMastered + (1 - pMastery) * pCorrectGivenNotMastered;
    pMasteredGivenObs = (pMastery * pCorrectGivenMastered) / pCorrect;
  } else {
    const pWrong = pMastery * pS + (1 - pMastery) * (1 - pG);
    pMasteredGivenObs = (pMastery * pS) / pWrong;
  }

  const posterior = pMasteredGivenObs + (1 - pMasteredGivenObs) * BKT.pT;
  return Math.max(0.02, Math.min(0.98, posterior));
}

/**
 * Weighted aggregate P(pass). Weights are per-subtopic and should sum to
 * ~1.0 within an exam, but we normalize defensively so a weight drift
 * doesn't break the denominator.
 */
export function pPass(
  subtopics: { weight: number; pMastery: number }[],
): number {
  if (subtopics.length === 0) return 0;
  const totalWeight = subtopics.reduce((s, t) => s + t.weight, 0) || 1;
  return subtopics.reduce(
    (s, t) => s + (t.weight / totalWeight) * t.pMastery,
    0,
  );
}

/**
 * Map BKT pMastery (0..1, practically capped at 0.95 by bktTarget) to a
 * displayed percentage (0..100). Two dampeners:
 *   1. Volume floor — early questions can't spike the bar. Until the user
 *      has answered 20 questions on this subtopic, the display is floored
 *      by `attempts / 20` of the raw value. Fresh users spend the first
 *      chunk of the session exploring, which matches Sam's "little by little"
 *      feel.
 *   2. Target normalization — bktTarget (default 0.95) maps to 100%, so the
 *      bar is reachable through real grinding rather than asymptoting
 *      forever at 0.95.
 */
export function displayPct(
  pMastery: number,
  attempts: number,
  bktTarget: number = 0.95,
): number {
  // Hard zero for fresh subtopics — BKT carries a 0.10 prior that we don't
  // want leaking into the UI as "mastered" before the user has answered
  // anything.
  if (attempts === 0) return 0;
  // Cap the displayed bar by attempts/40, so one session can't vault a bar
  // to 80%. Real cert prep takes ~40+ attempts per subtopic to hit mastery.
  // Also cap by raw normalized (pMastery/target) so users never see more
  // than their actual Bayesian posterior.
  const normalized = Math.min(1, pMastery / bktTarget);
  const volumeCap  = Math.min(1, attempts / 40);
  return Math.max(0, Math.min(100, Math.min(normalized, volumeCap) * 100));
}

/**
 * Pick the next subtopic to drill. Score = weight × gap so we spend time on
 * the biggest weighted weakness. Small recency bonus so we don't hammer the
 * same subtopic forever when it's borderline — breaks ties in favor of
 * variety without letting variety win over genuine weakness.
 */
export function pickNextSubtopic(
  subtopics: {
    subtopicId: string;
    weight: number;
    pMastery: number;
    lastSeenAt?: number | null;
  }[],
  now: number = Date.now(),
): string | null {
  if (subtopics.length === 0) return null;

  const scored = subtopics.map(t => {
    const gap = Math.max(0, 0.85 - t.pMastery);
    const recencySec = t.lastSeenAt ? (now - t.lastSeenAt) / 1000 : 1e9;
    const recencyBonus = Math.min(0.05, recencySec / 60_000); // 1 min → ~0.001
    return { id: t.subtopicId, score: t.weight * gap + recencyBonus };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].id : null;
}

/**
 * Are we at mastery for the whole exam? Gate is both the weighted aggregate
 * crossing `threshold` AND no individual subtopic below a floor (default
 * 0.60) — so a user can't coast to "ready" by overperforming on one topic.
 */
export function isPassReady(
  subtopics: { weight: number; pMastery: number }[],
  threshold: number = 0.80,
  perSubtopicFloor: number = 0.60,
): boolean {
  const pass = pPass(subtopics);
  const noBreach = subtopics.every(t => t.pMastery >= perSubtopicFloor);
  return pass >= threshold && noBreach;
}

/**
 * 100% "Mastery Level" reached — used for the Confetti + badge moment.
 * Every subtopic ≥ bktTarget AND weighted pPass ≥ bktTarget.
 */
export function isMasteryReached(
  subtopics: { weight: number; pMastery: number }[],
  bktTarget: number = 0.95,
): boolean {
  if (subtopics.length === 0) return false;
  const allAbove = subtopics.every(t => t.pMastery >= bktTarget);
  const aggregateAbove = pPass(subtopics) >= bktTarget;
  return allAbove && aggregateAbove;
}

/**
 * Pick a difficulty for the next question. "easy" is reserved for warm-up
 * only — a specialty cert has no truly easy questions, so we default to
 * medium almost immediately and escalate to hard past 0.65. The 0.65
 * threshold (vs 0.75 previously) matches the tuned BKT curve.
 */
export function pickDifficulty(pMastery: number): Difficulty {
  if (pMastery < 0.65) return "medium";
  return "hard";
}
