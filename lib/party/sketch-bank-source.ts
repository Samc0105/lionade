// Sketchy Subjects — Word Bank source helpers.
//
// A player can point a sketch round at one of their own Word Banks (vocab_banks)
// instead of a curated subject. The choice is encoded inside
// party_room_players.selected_subjects (a text[]) as the token
// "bank:<bankUuid>" — curated subjects stay bare ("biology").
//
// FROZEN CONTRACT:
//   - token shape: "bank:<bankUuid>"
//   - MIN_BANK_WORDS = 30: a bank is ELIGIBLE to be chosen only if it is OWNED
//     by the caller AND has >= 30 vocab_words.
//   - A bank ROUND falls back to a curated subject only if the bank was deleted
//     or dropped below MIN_BANK_WORDS_TO_PLAY words at draw time (so a round in
//     progress never blocks). Eligibility (picking) and playability (drawing)
//     use different floors on purpose: 30 to opt in, 3 to keep an already-chosen
//     bank playable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WordEntry } from "./word-lists-stub";

export const BANK_TOKEN_PREFIX = "bank:";
// Minimum word count for a bank to be OFFERED / accepted as a pick.
export const MIN_BANK_WORDS = 30;
// Minimum word count for an already-chosen bank to still produce a round.
// Below this we fall back to a curated subject so the round never blocks.
export const MIN_BANK_WORDS_TO_PLAY = 3;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBankToken(token: string): boolean {
  return token.startsWith(BANK_TOKEN_PREFIX);
}

/** Extract the bank uuid from a "bank:<uuid>" token, or null if malformed. */
export function parseBankToken(token: string): string | null {
  if (!isBankToken(token)) return null;
  const id = token.slice(BANK_TOKEN_PREFIX.length).trim();
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

export function bankToken(bankId: string): string {
  return `${BANK_TOKEN_PREFIX}${bankId}`;
}

/**
 * Validate a set of bank uuids: returns the subset that is OWNED by `userId`
 * AND has >= MIN_BANK_WORDS words. Uses supabaseAdmin (service role bypasses
 * RLS), so ownership is enforced HERE in route logic, not by the DB.
 */
export async function filterEligibleOwnedBanks(
  supabase: SupabaseClient,
  userId: string,
  bankIds: string[],
): Promise<Set<string>> {
  const eligible = new Set<string>();
  const unique = Array.from(new Set(bankIds));
  if (unique.length === 0) return eligible;

  // Only the caller's OWN banks — ownership gate in route logic.
  const { data: ownedBanks } = await supabase
    .from("vocab_banks")
    .select("id")
    .eq("user_id", userId)
    .in("id", unique);
  const ownedIds = Array.from(
    new Set((ownedBanks ?? []).map((b) => b.id as string)),
  );
  if (ownedIds.length === 0) return eligible;

  // Word count per owned bank. We issue one head-count per owned bank; a user
  // has only a handful of banks so this stays cheap.
  for (const id of ownedIds) {
    const { count } = await supabase
      .from("vocab_words")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("bank_id", id);
    if ((count ?? 0) >= MIN_BANK_WORDS) eligible.add(id);
  }
  return eligible;
}

/** Map a vocab_words row to a sketch bank candidate (FROZEN candidate shape). */
export function bankWordToCandidate(row: {
  word: string;
  term_definition?: string | null;
  translation?: string | null;
  user_definition?: string | null;
}): WordEntry & { source: "bank" } {
  const factoid =
    row.term_definition ?? row.translation ?? row.user_definition ?? "";
  return {
    word: row.word,
    difficulty: "medium",
    factoid,
    source: "bank",
  };
}
