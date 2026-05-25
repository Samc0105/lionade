/**
 * Shared SWR persistence storage adapter contract.
 *
 * Both web (localStorage) and iOS (AsyncStorage) implement this interface
 * so that the SWR Map-backed provider in each app can be wired with a
 * single, identical hydrate/persist pattern. The actual adapter
 * implementations live in their respective consumer repos:
 *
 *   web → ~/Desktop/lionade/lib/swr-storage-adapter.ts (admin/web team owns)
 *   iOS → ~/Desktop/lionade-ios/lib/swr-config.ts       (vp-ios owns)
 *
 * Why this lives in `@lionade/core`:
 *   - The Map-provider factory below is shared logic (hydrate-on-init,
 *     write-through .set/.delete, debounced persist, LRU prune). Web
 *     and iOS both need this exact behavior; differences should be
 *     limited to the underlying I/O calls.
 *   - The `cacheKeys` registry already lives next door (./keys.ts). The
 *     storage layer is the natural sibling.
 *
 * Method shape mirrors the React Native AsyncStorage / DOM localStorage
 * common subset, both promise-flavored for symmetry. localStorage's
 * synchronous calls can trivially be wrapped in `Promise.resolve()` on
 * the web side.
 */

export interface StorageAdapter {
  /** Read raw string at key. Resolves null when key is absent. */
  getItem(key: string): Promise<string | null>;
  /** Write raw string at key. */
  setItem(key: string, value: string): Promise<void>;
  /** Remove key. Safe to call on absent keys. */
  removeItem(key: string): Promise<void>;
}

/**
 * Singleton cache key used by the persistence layer. Both web + iOS
 * write the full Map snapshot under this single AsyncStorage /
 * localStorage entry; SWR cache keys are the SECOND level (inside the
 * JSON payload). This is intentional: it makes hydrate O(1 disk read)
 * and trades per-key invalidation granularity for cold-start speed.
 *
 * Bumping the version invalidates all clients — use sparingly.
 */
export const SWR_PERSIST_KEY = "lionade-swr-cache-v1";

/** Soft cap on entries — beyond this we evict oldest first on next write. */
export const SWR_PERSIST_MAX_ENTRIES = 500;

/** Debounce window for write-through persistence. */
export const SWR_PERSIST_DEBOUNCE_MS = 500;

/**
 * The result of `createPersistedSwrProvider`. The Map is what SWR's
 * `provider:` config consumes. `readyPromise` resolves once the initial
 * disk read has completed and the Map has been populated — consumers
 * who care about guaranteed-hydrated first paint (e.g. iOS splash gate)
 * await this before mounting <SWRConfig>.
 */
export interface PersistedSwrProvider {
  cache: Map<string, unknown>;
  readyPromise: Promise<void>;
  /** Manually flush the in-memory map to disk. Bypasses the debounce. */
  flush(): Promise<void>;
}

/**
 * Factory that wires a Map-backed SWR cache to a `StorageAdapter`.
 *
 * Pattern:
 *   1. Return immediately with an empty Map + a `readyPromise`.
 *   2. Asynchronously read the persisted JSON; populate the Map; resolve
 *      `readyPromise`.
 *   3. Intercept `.set` / `.delete` so every mutation schedules a
 *      debounced write back to the adapter.
 *
 * Hydration is cold-start-only. The factory does not re-hydrate on
 * AppState transitions, page visibility, or any other lifecycle event —
 * that would defeat the AppState/focus-debounce protections that the
 * SWR config layer applies. Re-hydration would also overwrite live
 * in-memory state with whatever was on disk, causing UI rewinds.
 *
 * Eviction: LRU by insertion order. Map iteration order is insertion
 * order; we delete from the front when size exceeds the cap. Reads
 * don't promote — this is a coarse FIFO, not a true LRU, but adequate
 * as an unbounded-growth guard for a cache that already aggressively
 * dedupes by key.
 */
export function createPersistedSwrProvider(
  adapter: StorageAdapter,
  opts?: {
    /** Override the on-disk key. Defaults to SWR_PERSIST_KEY. */
    persistKey?: string;
    /** Override the soft cap. Defaults to SWR_PERSIST_MAX_ENTRIES. */
    maxEntries?: number;
    /** Override the debounce window. Defaults to SWR_PERSIST_DEBOUNCE_MS. */
    debounceMs?: number;
    /**
     * Optional logger for hydrate / persist errors. Both platforms have
     * Sentry available but the shared layer can't import it; pass a
     * thin wrapper from each consumer if you want telemetry.
     */
    onError?: (where: "hydrate" | "persist", error: unknown) => void;
  },
): PersistedSwrProvider {
  const persistKey = opts?.persistKey ?? SWR_PERSIST_KEY;
  const maxEntries = opts?.maxEntries ?? SWR_PERSIST_MAX_ENTRIES;
  const debounceMs = opts?.debounceMs ?? SWR_PERSIST_DEBOUNCE_MS;
  const onError = opts?.onError ?? (() => {});

  const map = new Map<string, unknown>();

  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  async function persistNow(): Promise<void> {
    try {
      // LRU prune if we've blown the cap. Insertion-order is the proxy
      // for least-recently-set; not perfect (read-only access doesn't
      // promote) but good enough for an unbounded-growth guard.
      while (map.size > maxEntries) {
        const firstKey = map.keys().next().value;
        if (firstKey === undefined) break;
        map.delete(firstKey);
      }
      const obj: Record<string, unknown> = {};
      map.forEach((v, k) => {
        obj[k] = v;
      });
      await adapter.setItem(persistKey, JSON.stringify(obj));
    } catch (err) {
      onError("persist", err);
    }
  }

  function schedulePersist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void persistNow();
    }, debounceMs);
  }

  // Intercept .set / .delete BEFORE we kick off hydrate, so any
  // mutations that race with the async read still trigger a persist.
  const originalSet = map.set.bind(map);
  const originalDelete = map.delete.bind(map);
  map.set = (key: string, value: unknown) => {
    const result = originalSet(key, value);
    schedulePersist();
    return result;
  };
  map.delete = (key: string) => {
    const result = originalDelete(key);
    schedulePersist();
    return result;
  };

  const readyPromise = (async () => {
    try {
      const json = await adapter.getItem(persistKey);
      if (!json) return;
      const parsed = JSON.parse(json) as Record<string, unknown>;
      // Use the ORIGINAL set so hydrate doesn't schedule a redundant
      // write-back of the data we just read off disk.
      Object.entries(parsed).forEach(([k, v]) => originalSet(k, v));
    } catch (err) {
      onError("hydrate", err);
      // Corrupted cache — wipe it so next boot is clean.
      try {
        await adapter.removeItem(persistKey);
      } catch {
        /* nothing else we can do */
      }
    }
  })();

  return {
    cache: map,
    readyPromise,
    flush: persistNow,
  };
}
