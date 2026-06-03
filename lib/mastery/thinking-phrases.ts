/**
 * Rotating "Ninny is thinking..." phrases for Mastery Mode.
 *
 * V1 starter pool of ~30 phrases organized into context buckets. The picker
 * biases toward the most specific bucket (POST_CORRECT, POST_WRONG, STREAK,
 * LATE_SESSION, FIRST) when applicable, otherwise falls back to NEUTRAL.
 *
 * Voice rules (locked):
 *   - Gen Z native, lightly chaotic, never crass.
 *   - No em-dashes (project rule [[feedback_no_dashes_in_copy]]).
 *   - Ellipses + lowercase okay; periods optional.
 *   - Always sounds like Ninny: warm, conspiratorial, never robotic.
 *
 * design-copywriter is the long-term owner of expanding this beyond 30.
 */

export type ThinkingBucket =
  | "NEUTRAL"
  | "POST_CORRECT"
  | "POST_WRONG"
  | "STREAK"
  | "LATE_SESSION"
  | "FIRST";

export type ThinkingContext = {
  /** 0-based question index in the session; 0 hints "FIRST". */
  questionIndex?: number;
  /** Total questions planned for this session (drives LATE_SESSION calc). */
  totalQuestions?: number;
  /** Outcome of the most-recent answer. null = first question of session. */
  lastAnswerCorrect?: boolean | null;
  /** Consecutive correct answers ending at the most recent question. */
  currentStreak?: number;
};

/** Phrase pool — V1 ships 30. Group order doesn't matter; picker handles bias. */
const PHRASE_POOL: Record<ThinkingBucket, readonly string[]> = {
  NEUTRAL: [
    "Let me cross-reference your notes...",
    "OK so where are you actually struggling...",
    "Pulling threads from your last few answers...",
    "Hmm, this one's tricky to phrase...",
    "Let me think about how to make this stick...",
    "Cooking up something for you...",
    "Looking up something quick...",
    "One sec, picking the right angle...",
    "Let me line this up...",
    "Sorting through what you've nailed and what's fuzzy...",
  ],
  POST_CORRECT: [
    "Nice. Let me push a bit harder...",
    "You've earned a sneakier one...",
    "OK you're warmed up, here comes a real one...",
    "Let me find something at your level...",
  ],
  POST_WRONG: [
    "Let me try a softer angle on this...",
    "OK let me find a fresh way in...",
    "Backing up a step, hold on...",
    "Different framing coming up...",
  ],
  STREAK: [
    "You're on a tear. Hold on...",
    "Streak going, let me match it...",
    "OK champion, you asked for it...",
  ],
  LATE_SESSION: [
    "Saving good ones for the home stretch...",
    "Final stretch, picking carefully...",
    "Wrapping the loose ends...",
  ],
  FIRST: [
    "Let me get a read on where you're at...",
    "First one, getting the temperature...",
    "Easing in, give me a sec...",
  ],
};

/** Total phrase count (exported so QA / docs can assert pool size). */
export const PHRASE_COUNT: number = Object.values(PHRASE_POOL).reduce(
  (sum, arr) => sum + arr.length,
  0,
);

/**
 * Module-level "last picked" tracker. We dedupe back-to-back picks so the
 * user never sees the exact same phrase twice in a row even if random
 * lands on it. Reset is implicit on full page reload.
 */
let LAST_PICKED: string | null = null;

/**
 * Decide which bucket is most-specific for the given context. Returns a
 * priority-ordered candidate so the caller can roll a bias-die against it.
 *
 * Priority (most specific first):
 *   FIRST > STREAK > LATE_SESSION > POST_WRONG > POST_CORRECT > NEUTRAL
 *
 * FIRST is highest because it's the rarest signal (only fires once).
 * STREAK ranks above POST_CORRECT because "3+ in a row" is a louder signal
 * than "the last one was right".
 */
function pickBucket(ctx: ThinkingContext | undefined): ThinkingBucket {
  if (!ctx) return "NEUTRAL";

  // FIRST — fires only on Q1 of a session
  if (ctx.questionIndex === 0) return "FIRST";

  // STREAK — 3+ consecutive correct
  if ((ctx.currentStreak ?? 0) >= 3) return "STREAK";

  // LATE_SESSION — 60%+ through. Need both numbers to compute the ratio.
  if (
    typeof ctx.questionIndex === "number"
    && typeof ctx.totalQuestions === "number"
    && ctx.totalQuestions > 0
    && ctx.questionIndex / ctx.totalQuestions >= 0.6
  ) {
    return "LATE_SESSION";
  }

  // POST_WRONG / POST_CORRECT
  if (ctx.lastAnswerCorrect === false) return "POST_WRONG";
  if (ctx.lastAnswerCorrect === true) return "POST_CORRECT";

  return "NEUTRAL";
}

/**
 * Pick one phrase. Specific-bucket bias: 70% chance the picker uses the
 * specific bucket, 30% falls back to NEUTRAL. NEUTRAL is the default for
 * empty / unknown context.
 *
 * Avoids returning the same phrase twice in a row. If the only candidate
 * IS the last-picked one (e.g. a 1-phrase pool), accepts the repeat
 * rather than infinite-looping.
 */
export function pickThinkingPhrase(ctx?: ThinkingContext): string {
  const specific = pickBucket(ctx);
  const useSpecific = specific !== "NEUTRAL" && Math.random() < 0.7;
  const bucketKey: ThinkingBucket = useSpecific ? specific : "NEUTRAL";
  const bucket = PHRASE_POOL[bucketKey];

  // Defensive: bucket should always have ≥1 entry, but if not, fall back
  // to NEUTRAL.
  const pool = bucket.length > 0 ? bucket : PHRASE_POOL.NEUTRAL;

  // Try a few rolls to avoid back-to-back repeats; if the bucket is tiny
  // and we keep landing on the previous pick, accept it after 3 tries.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (candidate !== LAST_PICKED) {
      LAST_PICKED = candidate;
      return candidate;
    }
  }
  const fallback = pool[Math.floor(Math.random() * pool.length)];
  LAST_PICKED = fallback;
  return fallback;
}

/**
 * Test helper — reset the dedup tracker. Safe to call from production code
 * too (e.g. on session start) if you want a clean slate.
 */
export function resetThinkingPhraseDedup(): void {
  LAST_PICKED = null;
}
