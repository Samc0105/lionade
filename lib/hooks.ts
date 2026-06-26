import { useEffect } from "react";
import useSWR, { mutate } from "swr";
import { cacheKeys } from "@lionade/core/cache/keys";
import { supabase } from "@/lib/supabase";
import { getLevelFromXp } from "@/lib/levels";

interface UserStats {
  coins: number;
  streak: number;
  xp: number;
  level: number;
  avatar: string | null;
}

async function fetchUserStats(userId: string): Promise<UserStats> {
  const { data, error } = await supabase
    .from("profiles")
    .select("coins, streak, xp, avatar_url")
    .eq("id", userId)
    .single();

  if (error || !data) throw error ?? new Error("No profile found");

  const xp = data.xp ?? 0;
  return {
    coins: data.coins ?? 0,
    streak: data.streak ?? 0,
    xp,
    level: getLevelFromXp(xp),
    avatar: data.avatar_url ?? null,
  };
}

export function useUserStats(userId: string | undefined) {
  const { data, error, isLoading, mutate: boundMutate } = useSWR(
    // Phase B: shared cacheKey registry (@lionade/core) — same string,
    // sourced from canonical helper so iOS + web cannot drift.
    userId ? cacheKeys.userStats(userId) : null,
    () => fetchUserStats(userId!),
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  // Realtime cross-device sync 2026-05-14 — mirrors the iOS hook pattern.
  // Subscribes to UPDATEs on this user's profile row, so changes made on
  // the iOS app (Fangs earned, streak tick, level up) propagate to the
  // open web tab without polling. RLS scopes the subscription to the
  // user's own row.
  //
  // Channel-name suffix is random per effect run because React StrictMode
  // double-invokes effects in dev — without the suffix the second run
  // collides with the still-subscribed channel from the first and
  // .on() throws "cannot add postgres_changes callbacks after subscribe()".
  useEffect(() => {
    if (!userId) return;
    const channelName = `profile:${userId}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        () => {
          // Re-fetch through the canonical RLS path so we never drift
          // from server truth.
          void boundMutate();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, boundMutate]);

  return { stats: data ?? null, error, isLoading, mutate: boundMutate };
}

/** Imperatively revalidate stats (e.g. after quiz completion) */
export function mutateUserStats(userId: string) {
  // Phase B: shared registry — see cacheKeys.userStats in @lionade/core.
  return mutate(cacheKeys.userStats(userId));
}

// ── Streak Info (for streak popup modal) ──

interface StreakInfo {
  lastQuizAt: string | null;
  questionsToday: number;
  hasStreakShield: boolean;
}

async function fetchStreakInfo(userId: string): Promise<StreakInfo> {
  const today = new Date().toISOString().split("T")[0];

  const [profileRes, shieldRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("last_activity_at, daily_questions_completed, daily_reset_date")
      .eq("id", userId)
      .single(),
    supabase
      .from("active_boosters")
      .select("id")
      .eq("user_id", userId)
      .eq("booster_effect", "streak_shield")
      .limit(1),
  ]);

  const profile = profileRes.data;
  // If daily_reset_date is not today, the counter hasn't been reset yet — show 0
  const questionsToday = Math.min(
    profile?.daily_reset_date === today
      ? (profile?.daily_questions_completed ?? 0)
      : 0,
    10
  );

  return {
    lastQuizAt: profile?.last_activity_at ?? null,
    questionsToday,
    hasStreakShield: (shieldRes.data?.length ?? 0) > 0,
  };
}

export function useStreakInfo(userId: string | undefined) {
  const { data, error, isLoading, mutate: boundMutate } = useSWR(
    userId ? `streak-info/${userId}` : null,
    () => fetchStreakInfo(userId!),
    { revalidateOnFocus: true, dedupingInterval: 10000, keepPreviousData: true }
  );

  return { streakInfo: data ?? null, error, isLoading, mutateStreakInfo: boundMutate };
}

/** Check if streak is expired (last_activity_at + 36h < now) */
export function isStreakExpired(lastQuizAt: string | null): boolean {
  if (!lastQuizAt) return false;
  const expires = new Date(lastQuizAt).getTime() + 36 * 60 * 60 * 1000;
  return Date.now() > expires;
}

// resetExpiredStreak was REMOVED in migration 078 phase 2: the expired-streak
// reset (snapshot -> open revive window -> zero the streak fields) now runs
// server-side at POST /api/streak/expire, because the streak/last_activity_at/
// daily_* columns are guarded against client writes. Callers use apiPost.

// ─────────────────────────────────────────────────────────────────────────────
// Shared read hooks — perf refactor 2026-05-17
//
// These wrap existing lib/db.ts functions (signatures UNCHANGED) behind SWR so
// the global localStorage-persisted <SWRConfig> cache makes navigation instant
// instead of cold-refetching on every mount. Keys are STABLE STRINGS, mirroring
// the `user-stats/${userId}` pattern above. Pages that previously did raw
// useState+useEffect+db-call now consume these so the data is deduped/shared
// across Dashboard / Learn / Profile / Badges / Leaderboard / Quiz.
//
// No new ad-hoc caching layer is introduced — the provider in lib/swr-config.ts
// is the single source of cache truth.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getSubjectStats,
  getQuizHistory,
  getAllBadges,
  getUserBadges,
  getLeaderboard,
  getEloLeaderboard,
  getActiveBet,
  type ActiveBet,
} from "@/lib/db";
import { apiGet } from "@/lib/api-client";

// ── Daily Missions ────────────────────────────────────────────
// Shared across Dashboard + the Quiz "Missions & Bet" float so
// both surfaces hit the same SWR cache (key: `dashboard-missions/${uid}`).
// When the float `mutate()`s after each answer, the dashboard's still-
// mounted hook picks it up too — single source of truth.

export interface DailyMission {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: string;
  target: number;
  coinReward: number;
  xpReward: number;
  color: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface DailyMissionsPayload {
  missions: DailyMission[];
  resetsIn: string;
}

export function useDailyMissions(userId: string | undefined) {
  return useSWR<DailyMissionsPayload>(
    userId ? `dashboard-missions/${userId}` : null,
    async () => {
      const res = await apiGet<DailyMissionsPayload>("/api/missions/progress");
      return res.ok && res.data ? res.data : { missions: [], resetsIn: "" };
    },
    { keepPreviousData: true }
  );
}

// ── Active Daily Bet ──────────────────────────────────────────
// Same shared-cache rationale as missions. Key: `dashboard-active-bet/${uid}`.

export function useActiveBet(userId: string | undefined) {
  return useSWR<ActiveBet | null>(
    userId ? `dashboard-active-bet/${userId}` : null,
    () => getActiveBet(userId!).catch(() => null),
    { keepPreviousData: true }
  );
}

/** Subject stats (Dashboard + Profile + Quiz select screen). */
export function useSubjectStats(
  userId: string | undefined,
  opts?: { lifetime?: boolean }
) {
  const lifetime = opts?.lifetime ? "lifetime" : "window";
  return useSWR(
    userId ? `subject-stats/${userId}/${lifetime}` : null,
    () => getSubjectStats(userId!, opts),
    { keepPreviousData: true }
  );
}

/** Recent quiz history (Dashboard recent list, Learn activity, Profile). */
export function useQuizHistory(userId: string | undefined, limit = 10) {
  return useSWR(
    userId ? `quiz-history/${userId}/${limit}` : null,
    () => getQuizHistory(userId!, limit),
    { keepPreviousData: true }
  );
}

/** Full badge catalog — effectively static; long dedupe so it never re-fetches
 *  while navigating. */
export function useAllBadges() {
  return useSWR("all-badges", () => getAllBadges(), {
    keepPreviousData: true,
    dedupingInterval: 5 * 60_000,
    revalidateOnFocus: false,
  });
}

/** Badges a user has earned (Badges page + Profile). */
export function useUserBadges(userId: string | undefined) {
  return useSWR(
    userId ? `user-badges/${userId}` : null,
    () => getUserBadges(userId!),
    { keepPreviousData: true, dedupingInterval: 60_000 }
  );
}

/** Wallet transactions (Wallet page) — persisted SWR so the list paints
 *  instantly from cache on re-entry instead of cold-fetching with a skeleton
 *  on every visit. */
export function useTransactions(userId: string | undefined, limit = 20) {
  return useSWR(
    userId ? `wallet-transactions/${userId}/${limit}` : null,
    async () => {
      const { data, error } = await supabase
        .from("coin_transactions")
        .select("id, amount, type, description, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    { keepPreviousData: true, dedupingInterval: 10_000 }
  );
}

/** Recent Fang activity (Profile activity card). */
export function useRecentActivity(userId: string | undefined, limit = 8) {
  return useSWR(
    userId ? `recent-activity/${userId}/${limit}` : null,
    async () => {
      const { data, error } = await supabase
        .from("coin_transactions")
        .select("amount, type, description, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    { keepPreviousData: true }
  );
}

/** Weekly (coins-this-week) leaderboard. */
export function useWeeklyLeaderboard(limit = 200) {
  return useSWR(
    `leaderboard-weekly/${limit}`,
    () => getLeaderboard(limit),
    { keepPreviousData: true, dedupingInterval: 30_000 }
  );
}

/** ELO leaderboard. */
export function useEloLeaderboard(limit = 200) {
  return useSWR(
    `leaderboard-elo/${limit}`,
    () => getEloLeaderboard(limit),
    { keepPreviousData: true, dedupingInterval: 30_000 }
  );
}
