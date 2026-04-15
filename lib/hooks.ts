import useSWR, { mutate } from "swr";
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
    userId ? `user-stats/${userId}` : null,
    () => fetchUserStats(userId!),
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
      keepPreviousData: true,
    }
  );

  return { stats: data ?? null, error, isLoading, mutate: boundMutate };
}

/** Imperatively revalidate stats (e.g. after quiz completion) */
export function mutateUserStats(userId: string) {
  return mutate(`user-stats/${userId}`);
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

/** Reset expired streak in Supabase — sets streak=0, clears activity fields */
export async function resetExpiredStreak(userId: string): Promise<void> {
  await supabase
    .from("profiles")
    .update({
      streak: 0,
      last_activity_at: null,
      daily_questions_completed: 0,
      daily_reset_date: null,
    })
    .eq("id", userId);
}
