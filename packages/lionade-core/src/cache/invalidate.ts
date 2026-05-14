/**
 * Cascading cache invalidations — the "fix stale UI segments" pattern.
 *
 * Inspired by the Next.js 16 streaming-routes article. The same problem
 * exists at the SWR layer on Lionade: when a user finishes a quiz,
 * `useUserStats` updates instantly via optimistic mutation, but
 * `useRecentQuizzes` still shows the OLD quiz history for 30s until SWR
 * revalidates on its own.
 *
 * This module declares "when action X happens, these cache keys go stale
 * and need revalidation." The actual invalidation is platform-specific
 * (web's global `mutate()` from swr; iOS's bound `mutate()` from its
 * configured SWR instance), so this module returns the LIST of keys.
 * Each app's `lib/cache-invalidation.ts` wraps this with the SWR API.
 *
 * Usage from a feature handler:
 *
 *   // iOS / web — after a quiz completes
 *   import { invalidateAfter } from "@/lib/cache-invalidation";
 *   await invalidateAfter("quizCompleted", userId);
 *
 * The action map below is the source of truth. Adding a new action ===
 * adding a new key here.
 */

import { cacheKeys } from "./keys.js";

/** Every action the app emits that should invalidate related caches. */
export type CacheAction =
  | "quizCompleted"
  | "dailyDrillCompleted"
  | "clockInClaimed"
  | "streakRevived"
  | "spinRolled"
  | "missionClaimed"
  | "bountyClaimed"
  | "dailyBetPlaced"
  | "arenaMatchCompleted"
  | "duelCompleted"
  | "classCreated"
  | "classUpdated"
  | "noteCreated"
  | "flashcardRated"
  | "gradeChanged"
  | "syllabusUploaded"
  | "masterySessionAdvanced"
  | "profileUpdated";

/**
 * For a given action, return the list of SWR cache keys that should be
 * revalidated. Callers pass these to their SWR `mutate()` to trigger a
 * background re-fetch.
 *
 * Conventions:
 *   - userStats is in nearly every cascade because most actions affect
 *     Fangs/streak/XP/level. Plus the realtime channel on `profiles`
 *     already pushes the canonical row, so revalidating is cheap.
 *   - Avoid including keys that weren't actually staled by the action —
 *     each entry here is a real re-fetch that costs a roundtrip.
 *   - The "dailyDrillCompleted" cascade does NOT include studyDna because
 *     that page recomputes from a long window; the user can refresh
 *     manually if they're staring at it.
 */
export function keysForAction(action: CacheAction, userId: string): string[] {
  switch (action) {
    case "quizCompleted":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.recentQuizzes(userId),
        cacheKeys.weeklyActivity(userId),
        cacheKeys.subjectStats(userId),
        cacheKeys.missionsProgress(),
        cacheKeys.bounties(userId),
        cacheKeys.dailyBet(userId), // bet may resolve on this quiz
        cacheKeys.badges(userId), // perfect quiz can unlock a badge
        cacheKeys.wallet(userId),
      ];

    case "dailyDrillCompleted":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.dailyDrillStatus(),
        cacheKeys.missionsProgress(),
        cacheKeys.wallet(userId),
      ];

    case "clockInClaimed":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.clockInStatus(),
        cacheKeys.loginBonusStatus(),
        cacheKeys.wallet(userId),
      ];

    case "streakRevived":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.streakReviveStatus(),
        cacheKeys.wallet(userId),
      ];

    case "spinRolled":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.spinStatus(),
        cacheKeys.wallet(userId),
        // boosters/cosmetics may have changed — could invalidate inventory
        // when we wire inventory caching later
      ];

    case "missionClaimed":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.missionsProgress(),
        cacheKeys.wallet(userId),
      ];

    case "bountyClaimed":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.bounties(userId),
        cacheKeys.wallet(userId),
      ];

    case "dailyBetPlaced":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.dailyBet(userId),
        cacheKeys.wallet(userId),
      ];

    case "arenaMatchCompleted":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.arenaRank(userId),
        cacheKeys.arenaMatches(userId),
        cacheKeys.leaderboard(),
        cacheKeys.missionsProgress(),
        cacheKeys.bounties(userId),
        cacheKeys.wallet(userId),
      ];

    case "duelCompleted":
      return [
        cacheKeys.userStats(userId),
        cacheKeys.wallet(userId),
        cacheKeys.missionsProgress(),
      ];

    case "classCreated":
    case "classUpdated":
      return [cacheKeys.classes()];

    case "noteCreated":
      return [cacheKeys.classes(), cacheKeys.recentNotes()];

    case "flashcardRated":
      // No public class flashcard list in this scope — server applies SR
      // scheduling and our hook re-fetches on its own when paginating.
      return [];

    case "gradeChanged":
      // Class detail page reads grades; could be more targeted by classId
      // but cheap enough to revalidate the whole class.
      return [];

    case "syllabusUploaded":
      return [];

    case "masterySessionAdvanced":
      return [];

    case "profileUpdated":
      return [cacheKeys.userStats(userId)];

    default: {
      // Exhaustiveness check — TypeScript will flag a missing case.
      const _exhaustive: never = action;
      void _exhaustive;
      return [];
    }
  }
}
