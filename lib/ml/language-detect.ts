/**
 * Client-side language detection for Vocab self-definition input.
 *
 * Why this exists: the pedagogical move on `/learn/vocab` is forcing the user
 * to write their OWN simple definition in the TARGET language. If a user is
 * supposed to define a Spanish word in Spanish but types the definition in
 * English, they collect the Fang reward without doing the cognitive work that
 * builds real fluency. We can't enforce this server-side without an LLM call,
 * but franc-min ships pure-JS trigram-based language detection in ~50KB with
 * zero infra cost, so we can nudge the user in the textarea itself.
 *
 * franc-min (https://github.com/wooorm/franc) returns ISO 639-3 codes; we map
 * the two we care about (`eng` → `en`, `spa` → `es`) and treat everything else
 * (including franc's `und` "undetermined" output) as `unknown`. Constraining
 * detection to ONLY those two languages via `only: ['eng', 'spa']` makes it
 * both faster and dramatically less likely to mis-classify a short, mixed-
 * vocabulary definition as Portuguese or Catalan when it's really Spanish.
 *
 * Confidence: franc's `francAll(...)` returns `[lang, score][]` ranked, where
 * `score` is a 0..1 closeness metric (1 = perfect trigram match, 0 = no match).
 * We use the top score directly as `confidence`. Callers should treat anything
 * below ~0.5 as too noisy to act on.
 *
 * Below ~10 characters franc itself flags low-confidence; we short-circuit at
 * `text.trim().length < 10` and return `unknown` so a one-word answer like
 * `perro` doesn't fire a false-positive warning.
 *
 * Client-only: pulls `franc-min` directly. Never import this module from a
 * route handler or server component — keep the trigram dataset out of the
 * serverless bundle.
 */

import { francAll } from "franc-min";

export type DetectedLang = "en" | "es" | "unknown";

export interface DetectionResult {
  code: DetectedLang;
  /** 0-1, where 1 = certain. 0 when input is too short or unrecognized. */
  confidence: number;
  /** `null` when `code === "unknown"` (no claim either way). */
  matches_target: boolean | null;
}

const MIN_TEXT_LEN = 10;

// ISO 639-3 → ISO 639-1 mapping for the two languages we care about.
const ISO3_TO_ISO1: Record<string, DetectedLang> = {
  eng: "en",
  spa: "es",
};

export function detectLanguage(
  text: string,
  targetLang: "en" | "es",
): DetectionResult {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LEN) {
    return { code: "unknown", confidence: 0, matches_target: null };
  }

  // Constrain to the two we serve in Vocab V1 — faster + more accurate than
  // letting franc pick from ~80 candidates for a short definition.
  const ranked = francAll(trimmed, { only: ["eng", "spa"] });
  if (ranked.length === 0) {
    return { code: "unknown", confidence: 0, matches_target: null };
  }

  const [topIso3, topScore] = ranked[0];
  const code = ISO3_TO_ISO1[topIso3] ?? "unknown";
  if (code === "unknown") {
    return { code: "unknown", confidence: 0, matches_target: null };
  }

  return {
    code,
    confidence: Math.max(0, Math.min(1, topScore)),
    matches_target: code === targetLang,
  };
}
