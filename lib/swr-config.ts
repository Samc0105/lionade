/**
 * Web SWR config — localStorage-persistent cache + tuned revalidation.
 *
 * Phase B (2026-05-25): the Map-backed provider scaffold (hydrate-on-init,
 * write-through .set/.delete, debounced persist, LRU prune) was extracted
 * into `@lionade/core/cache/storage` by `ios-shared-core`. Both web and
 * iOS consume the same `createPersistedSwrProvider` factory; the only
 * platform-specific bits are the I/O adapter and any persist-skip policy.
 *
 *   - Shared factory:  packages/lionade-core/src/cache/storage.ts
 *   - Web I/O adapter: lib/cache/localStorageAdapter.ts (this consumer)
 *   - iOS I/O adapter: lionade-ios/lib/swr-config.ts (vp-ios consumer)
 *
 * Cold-load hydration is synchronous on web because localStorage is sync —
 * the factory's `readyPromise` resolves on the next microtask, so we mount
 * <SWRConfig> immediately and never see a flash-of-skeleton on first
 * paint. iOS uses the same factory but awaits `readyPromise` before
 * dropping its splash screen because AsyncStorage is genuinely async.
 *
 * Mounted at the root in `app/layout.tsx` via `<SWRConfig value={swrConfig}>`.
 */

import type { Cache, SWRConfiguration } from "swr";

import {
  createPersistedSwrProvider,
  SWR_PERSIST_KEY,
  type PersistedSwrProvider,
  type StorageAdapter,
} from "@lionade/core/cache/storage";
import {
  localStorageAdapter,
  stripSkippedKeys,
} from "@/lib/cache/localStorageAdapter";

/**
 * Wraps the raw localStorage adapter with a setItem filter that applies
 * the persist-skip policy. The shared factory writes the FULL Map JSON
 * blob under SWR_PERSIST_KEY on every debounced persist — this wrapper
 * intercepts that single blob write, parses it, strips skip-listed
 * entries, and re-serialises before handing off to the real adapter.
 *
 * Why intercept at the adapter layer rather than at the factory:
 *   - The shared factory has no concept of skip lists (intentional —
 *     skip policy is platform-specific, e.g. iOS has more storage
 *     budget so its skip list may be empty or smaller).
 *   - Doing the strip here keeps `swr-config.ts` declarative: "consume
 *     the factory with a policy-decorated adapter," vs. duplicating
 *     the persist-loop in this file.
 *
 * Trade-off: we re-parse/serialise the JSON blob once per persist. At
 * 500ms debounce + typical payload sizes this is sub-millisecond on the
 * main thread. Acceptable.
 */
function withSkipList(base: StorageAdapter): StorageAdapter {
  return {
    getItem: base.getItem.bind(base),
    removeItem: base.removeItem.bind(base),
    async setItem(key: string, value: string): Promise<void> {
      // Only filter the cache blob — other keys (if any future code
      // routes through this adapter) pass through untouched.
      if (key !== SWR_PERSIST_KEY) return base.setItem(key, value);
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const filtered = stripSkippedKeys(parsed);
        return base.setItem(key, JSON.stringify(filtered));
      } catch {
        // If for any reason the blob isn't JSON-shaped, fall through —
        // the factory always writes JSON so this branch is defensive only.
        return base.setItem(key, value);
      }
    },
  };
}

let providerSingleton: PersistedSwrProvider | null = null;

function getProvider(): Cache {
  if (providerSingleton) {
    return providerSingleton.cache as unknown as Cache;
  }
  providerSingleton = createPersistedSwrProvider(
    withSkipList(localStorageAdapter),
    {
      onError: (where, err) => {
        // Surface to console in dev; production should hook this to
        // Sentry once that's wired into the web app (tracked separately).
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(`[swr-cache] ${where} error:`, err);
        }
      },
    },
  );

  // Wire visibilitychange + beforeunload flushes — these are the same
  // resilience hooks Phase A had, just routed through the factory's
  // `flush()` API instead of an inline persist() call.
  if (typeof window !== "undefined") {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        void providerSingleton?.flush();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", () => {
      void providerSingleton?.flush();
    });
  }

  return providerSingleton.cache as unknown as Cache;
}

/**
 * Test-only: reset the singleton provider. Lets unit tests verify cold-load
 * hydration from a controlled localStorage state without polluting other
 * tests' caches.
 */
export function __resetSwrProviderForTests(): void {
  providerSingleton = null;
}

export const swrConfig: SWRConfiguration = {
  provider: () => getProvider(),
  // Default for the whole app. Hooks that need different cadence pass
  // their own override.
  //
  // 2026-05-25 (Phase A perf): revalidateOnFocus flipped to FALSE and
  // dedupingInterval bumped to 60s. Reason: tab-switching between Dashboard
  // ↔ Shop ↔ Academia was firing a full revalidation storm on every focus,
  // burning Supabase reads and producing perceptible jank. Hooks that DO
  // need cross-tab freshness (Navbar notifications, useUserStats Fangs
  // balance, Social unread badges, ClockIn, StreakRevive, DailySpin) keep
  // their per-hook `revalidateOnFocus: true` override. `keepPreviousData`
  // stays on globally so background revalidations never flash a skeleton.
  revalidateOnFocus: false,
  dedupingInterval: 60_000,
  // Don't aggressively retry on error — surface state to the consumer.
  shouldRetryOnError: false,
  // Keep showing the cached value while fetching the new one. Without
  // this, every revalidation flashes back to loading state which is
  // exactly the "feels broken" symptom we're trying to kill.
  keepPreviousData: true,
};
