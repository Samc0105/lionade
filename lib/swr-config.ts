/**
 * Web SWR config — localStorage-persistent cache + tuned revalidation.
 *
 * Before this existed, every cold tab open / hard refresh started with an
 * empty SWR cache. Every hook then fired its own fetch in parallel, and
 * the user saw skeletons for 0.5-1s before content materialised. Now the
 * cache survives across reloads via localStorage; the next open shows
 * last-known data instantly and revalidates in the background.
 *
 * Persistence strategy:
 *   - Synchronous hydrate from localStorage on first construction
 *   - Write-through Map (intercept set/delete) → debounced persist (500ms)
 *   - Also persist on `visibilitychange → hidden` (covers tab close,
 *     mobile background) and `beforeunload` (covers hard close + reload)
 *   - Versioned key so a future cache shape change can invalidate cleanly
 *   - SSR-safe: server-side returns a fresh empty Map (no localStorage)
 *
 * Mounted at the root in `app/layout.tsx` via `<SWRConfig value={swrConfig}>`.
 */

import type { Cache, SWRConfiguration } from "swr";

const CACHE_KEY = "lionade-swr-cache-v1";
const PERSIST_DEBOUNCE_MS = 500;
/** Soft cap on entries — beyond this we evict oldest first on next write. */
const MAX_ENTRIES = 500;

let memoryCache: Map<string, unknown> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persist(map: Map<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    // LRU prune if we've blown the cap. We don't track access time
    // explicitly; insertion-order is the next-best proxy (older keys
    // are most-likely no-longer-mounted).
    while (map.size > MAX_ENTRIES) {
      const firstKey = map.keys().next().value;
      if (firstKey === undefined) break;
      map.delete(firstKey);
    }
    const obj: Record<string, unknown> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    // Quota exceeded or stringification failed — give up silently. SWR
    // still has the in-memory cache so the session continues working.
  }
}

function debouncedPersist(map: Map<string, unknown>): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persist(map), PERSIST_DEBOUNCE_MS);
}

function buildWriteThroughMap(): Map<string, unknown> {
  const map = new Map<string, unknown>();

  // Hydrate synchronously from localStorage. This is the value: the
  // first render of any hook with a matching key sees real data, not
  // a skeleton.
  if (typeof window !== "undefined") {
    try {
      const json = window.localStorage.getItem(CACHE_KEY);
      if (json) {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        Object.entries(parsed).forEach(([k, v]) => map.set(k, v));
      }
    } catch {
      // Corrupted cache — wipe and start fresh.
      try {
        window.localStorage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  // Intercept .set / .delete so every cache write triggers a debounced
  // persist. This is the difference between "lose 4s of writes on a
  // hard kill" and "lose 500ms" — and crucially, the actual writes are
  // batched so we don't thrash localStorage on every keystroke.
  const originalSet = map.set.bind(map);
  const originalDelete = map.delete.bind(map);
  map.set = (key: string, value: unknown) => {
    const result = originalSet(key, value);
    debouncedPersist(map);
    return result;
  };
  map.delete = (key: string) => {
    const result = originalDelete(key);
    debouncedPersist(map);
    return result;
  };

  if (typeof window !== "undefined") {
    // Flush on tab background (covers mobile Safari) + actual close.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persist(map);
    });
    window.addEventListener("beforeunload", () => persist(map));
  }

  return map;
}

function getProvider(): Cache {
  if (memoryCache) return memoryCache as unknown as Cache;
  memoryCache = buildWriteThroughMap();
  return memoryCache as unknown as Cache;
}

export const swrConfig: SWRConfiguration = {
  provider: () => getProvider(),
  // Default for the whole app. Hooks that need different cadence pass
  // their own override.
  revalidateOnFocus: true,
  dedupingInterval: 5_000,
  // Don't aggressively retry on error — surface state to the consumer.
  shouldRetryOnError: false,
  // Keep showing the cached value while fetching the new one. Without
  // this, every revalidation flashes back to loading state which is
  // exactly the "feels broken" symptom we're trying to kill.
  keepPreviousData: true,
};
