// Process-local cache of the 3 candidate words shown to a sketch drawer.
//
// We hold the candidates server-side rather than including them in the round
// creation response so guessers can't peek into the response (drawer-only
// visibility is enforced by the `/words` route checking `drawer_user_id` against
// the verified bearer token).
//
// V1 is process-local (single-instance Vercel deploy). If we scale to multi-
// instance we'll promote this to Redis or a Postgres table with a TTL.

import type { WordEntry } from "./word-lists-stub";

declare global {
  // eslint-disable-next-line no-var
  var __sketchCandidates: Map<string, WordEntry[]> | undefined;
}

const cache: Map<string, WordEntry[]> = globalThis.__sketchCandidates ?? new Map();
globalThis.__sketchCandidates = cache;

export function setCandidates(roundId: string, candidates: WordEntry[]): void {
  cache.set(roundId, candidates);
}

export function readCandidates(roundId: string): WordEntry[] | undefined {
  return cache.get(roundId);
}

export function clearCandidates(roundId: string): void {
  cache.delete(roundId);
}
