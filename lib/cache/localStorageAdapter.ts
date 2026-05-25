/**
 * Web localStorage adapter for the SWR cache provider.
 *
 * Implements the canonical `StorageAdapter` interface shipped by
 * `ios-shared-core` in `@lionade/core/cache/storage`. The actual provider
 * scaffold (hydrate-on-init, write-through Map, debounced persist, LRU
 * prune) lives in the shared package as `createPersistedSwrProvider` —
 * this file only owns the platform-specific I/O (window.localStorage) and
 * the web-specific persist-skip list.
 *
 * Web is in the lucky position that `localStorage` is synchronous, so the
 * shared factory's `readyPromise` resolves on the next microtask — no
 * splash gating needed (iOS uses the same factory but gates SplashScreen
 * on the readyPromise because AsyncStorage is genuinely async).
 *
 * Persist-skip list: some SWR keys are too large or too volatile to
 * justify the localStorage round-trip. We wrap the `setItem` adapter call
 * with a layer that strips skip-listed keys from the persisted JSON blob
 * before writing. The in-memory Map cache still holds the entry — only
 * disk persistence is skipped.
 */

import type { StorageAdapter } from "@lionade/core/cache/storage";

// ─── Persist-skip list ──────────────────────────────────────────────────────
//
// Reasoning behind each entry is in PHASE_B_NOTES.md §3 — keep in sync.
//
// We match by PREFIX (using startsWith) because most volatile keys are
// userId-namespaced and we don't want to enumerate every userId.
const PERSIST_SKIP_PREFIXES: readonly string[] = [
  // Full leaderboard payloads (200+ rows) — re-fetch is fast (single query)
  // and SWR already revalidates them on a 30s cadence, so disk persistence
  // wastes the ~5–10 MB budget on something we'd refresh anyway.
  "leaderboard-",

  // Social feed — feed items include attached user previews + activity blobs
  // that bloat fast. Re-fetch on visibilityChange is acceptable.
  "social-feed/",

  // Dashboard weekly chart — rich daily-bucket breakdown, only useful while
  // the user is on the dashboard. Persisting it just so it survives a
  // closed-tab → reopen isn't worth the bytes.
  "dashboard-weekly-chart/",

  // Mastery sessions — session payloads include question text + history; can
  // grow large quickly and the session is short-lived (user finishes within
  // minutes). Skip persistence; SWR fetches fresh on next visit.
  "mastery-session/",
];

/** Returns true if the key should NOT be written to disk. */
export function isPersistSkipped(key: string): boolean {
  return PERSIST_SKIP_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// ─── localStorage adapter ───────────────────────────────────────────────────

/**
 * The web adapter. Wraps `window.localStorage` in Promise-returning methods
 * so it conforms to the shared `StorageAdapter` contract. The shared factory
 * `createPersistedSwrProvider` does all the orchestration; this adapter only
 * does I/O.
 *
 * SSR-safe: every method checks for `window` and returns the empty result on
 * the server (Next.js renders the layout server-side; the provider re-builds
 * once the client mounts).
 *
 * Quota handling: localStorage's typical 5–10 MB cap can be hit if a user
 * collects 500+ cache entries with large payloads. On `setItem` quota
 * exception we resolve silently — the shared factory's onError logger
 * receives it via the wrapping handler in `swr-config.ts`. SWR still has
 * the in-memory entry so the session continues working.
 *
 * Persist-skip: when the factory calls `setItem(SWR_PERSIST_KEY, jsonBlob)`
 * with the full Map snapshot, we DO want to write the blob — but we want
 * to strip skip-listed keys from the blob first. Since the factory
 * stringifies the whole Map before handing it to us, the cleanest place
 * to filter is at the factory layer, not here. We expose a helper
 * (`stripSkippedKeys`) for `swr-config.ts` to apply before the blob is
 * written. This adapter itself stays a pure I/O surface.
 */
export const localStorageAdapter: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      // localStorage can throw in private-browsing / disabled-storage mode.
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or disabled — silently drop. The in-memory cache
      // still has the entry; we just don't persist past tab close.
    }
  },

  async removeItem(key: string): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Returns a copy of `obj` with any skip-listed keys removed. Called by
 * `swr-config.ts` immediately before the JSON blob is handed to the
 * adapter — keeps the persistence-policy in this file (web-local) and
 * out of the shared factory (which has no concept of skip lists).
 */
export function stripSkippedKeys(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!isPersistSkipped(k)) out[k] = v;
  }
  return out;
}
