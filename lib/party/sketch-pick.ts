// Sketchy Subjects — shared candidate-word picking.
//
// Used by both the round-create route (app/api/party/sketch/rounds/route.ts)
// and the reroll route (.../rounds/[id]/reroll) so a rerolled round draws from
// exactly the same logic as the original pick.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WORD_LISTS_STUB,
  type Subject,
  type WordEntry,
} from "./word-lists-stub";
import { WORD_LISTS as CURATED_WORD_LISTS } from "./word-lists";
import { bankWordToCandidate, MIN_BANK_WORDS_TO_PLAY } from "./sketch-bank-source";

// ── Difficulty-tiered candidate picking ──────────────────────────────
// The drawer is always offered one EASY, one MEDIUM, and one HARD word, in
// that order. If a subject's pool is thin on a tier, we fall back to the
// NEAREST tier (never error). Words are never duplicated across the 3 slots.
const TIER_ORDER = ["easy", "medium", "hard"] as const;
type Tier = (typeof TIER_ORDER)[number];
const TIER_FALLBACKS: Record<Tier, Tier[]> = {
  easy: ["easy", "medium", "hard"],
  medium: ["medium", "easy", "hard"],
  hard: ["hard", "medium", "easy"],
};

export function pickTieredCandidates(pool: WordEntry[]): WordEntry[] {
  if (pool.length === 0) return [];
  const byTier: Record<Tier, WordEntry[]> = { easy: [], medium: [], hard: [] };
  for (const entry of pool) {
    const tier: Tier = (TIER_ORDER as readonly string[]).includes(entry.difficulty)
      ? (entry.difficulty as Tier)
      : "medium";
    byTier[tier].push(entry);
  }
  const used = new Set<string>();
  const picks: WordEntry[] = [];
  for (const tier of TIER_ORDER) {
    for (const fallback of TIER_FALLBACKS[tier]) {
      const available = byTier[fallback].filter((e) => !used.has(e.word));
      if (available.length > 0) {
        const pick = available[Math.floor(Math.random() * available.length)];
        used.add(pick.word);
        picks.push(pick);
        break;
      }
    }
  }
  return picks;
}

export function pickCandidatesForSubject(subject: Subject): WordEntry[] {
  const curated = (CURATED_WORD_LISTS as Record<string, WordEntry[] | undefined>)[subject];
  const pool = curated && curated.length > 0 ? curated : WORD_LISTS_STUB[subject] ?? [];
  return pickTieredCandidates(pool);
}

/**
 * Pick 3 candidates for a curated subject. Tries the party_word_lists DB pool
 * first (one tier each), then the curated/stub pools, then a biology hard
 * fallback so a round is never blocked.
 */
export async function pickCuratedCandidates(
  supabase: SupabaseClient,
  subject: string,
): Promise<WordEntry[]> {
  let candidates: WordEntry[] = [];
  const { data: dbWords } = await supabase
    .from("party_word_lists")
    .select("word, difficulty, factoid")
    .eq("subject", subject)
    .limit(500);
  if (dbWords && dbWords.length >= 3) {
    candidates = pickTieredCandidates(
      dbWords.map((r) => ({
        word: r.word as string,
        difficulty: (r.difficulty ?? "medium") as WordEntry["difficulty"],
        factoid: r.factoid as string,
      })),
    );
  } else {
    candidates = pickCandidatesForSubject(subject as Subject);
  }
  if (candidates.length === 0) {
    candidates = pickTieredCandidates(WORD_LISTS_STUB.biology);
  }
  return candidates;
}

/**
 * Pick 3 random bank candidates for a bank, verifying it still exists, is
 * OWNED by ownerId, and still has >= MIN_BANK_WORDS_TO_PLAY words. Returns null
 * (caller should fall back to curated) otherwise.
 */
export async function pickBankCandidates(
  supabase: SupabaseClient,
  bankId: string,
  ownerId: string,
): Promise<(WordEntry & { source: "bank" })[] | null> {
  const { data: bank } = await supabase
    .from("vocab_banks")
    .select("id, user_id")
    .eq("id", bankId)
    .maybeSingle();
  if (!bank || bank.user_id !== ownerId) return null;

  const { data: words } = await supabase
    .from("vocab_words")
    .select("word, term_definition, translation, user_definition")
    .eq("user_id", ownerId)
    .eq("bank_id", bankId)
    .limit(500);
  if (!words || words.length < MIN_BANK_WORDS_TO_PLAY) return null;

  return [...words]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((w) =>
      bankWordToCandidate({
        word: w.word as string,
        term_definition: w.term_definition as string | null,
        translation: w.translation as string | null,
        user_definition: w.user_definition as string | null,
      }),
    );
}
