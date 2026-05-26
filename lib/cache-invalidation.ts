import { mutate } from "swr";

import {
  keysForAction,
  type CacheAction,
} from "@lionade/core/cache/invalidate";
import { cacheKeys } from "@lionade/core/cache/keys";

/**
 * Cache-tag invalidation wrapper for the web — uses SWR's global
 * `mutate` to revalidate every cache key that's affected by a given
 * action.
 *
 * Mirrors iOS `lib/cache-invalidation.ts` exactly so the same action
 * names produce the same cascade on both platforms. Adding a new
 * action is a one-place change in `@lionade/core/cache/invalidate.ts`.
 *
 * Usage from a feature handler:
 *
 *   import { invalidateAfter } from "@/lib/cache-invalidation";
 *   await apiPost("/api/save-quiz-results", payload);
 *   void invalidateAfter("quizCompleted", userId);
 *
 * Resolves once every revalidation request is dispatched. The caller
 * doesn't need to await — fire-and-forget is fine because each hook
 * already handles its own loading state during the re-fetch.
 *
 * Fixes the "stale UI segments" bug — the same problem Next.js 16's
 * `revalidateTag()` addresses for server caches, applied at the
 * client SWR layer.
 */
export async function invalidateAfter(
  action: CacheAction,
  userId: string,
): Promise<void> {
  const keys = keysForAction(action, userId);

  // Web-only aliases — the shared @lionade/core cacheKeys registry
  // currently uses `/api/missions/progress` and `["daily-bet",…]` for
  // missionsProgress/dailyBet, but the live web SWR hooks
  // (`useDailyMissions`, `useActiveBet`) key as `dashboard-missions/${uid}`
  // and `dashboard-active-bet/${uid}`. Until the registry is reconciled
  // across platforms, append the web keys here so the cascade actually
  // hits the live caches.
  const webAliases: Record<string, string[]> = {
    quizCompleted: [
      `dashboard-missions/${userId}`,
      `dashboard-active-bet/${userId}`,
    ],
    missionClaimed: [`dashboard-missions/${userId}`],
    dailyBetPlaced: [`dashboard-active-bet/${userId}`],
  };
  const extras = webAliases[action] ?? [];

  await Promise.all([...keys, ...extras].map((key) => mutate(key)));
}

// Re-export so callers have a single ergonomic surface.
export { cacheKeys, keysForAction };
export type { CacheAction };
