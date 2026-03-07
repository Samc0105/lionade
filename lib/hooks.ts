import useSWR, { mutate } from "swr";
import { supabase } from "@/lib/supabase";

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
    level: Math.floor(xp / 1000) + 1,
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

  const [quizRes, dailyRes, shieldRes] = await Promise.all([
    supabase
      .from("quiz_sessions")
      .select("completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("daily_activity")
      .select("questions_answered")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle(),
    supabase
      .from("active_boosters")
      .select("id")
      .eq("user_id", userId)
      .eq("booster_effect", "streak_shield")
      .limit(1),
  ]);

  return {
    lastQuizAt: quizRes.data?.completed_at ?? null,
    questionsToday: dailyRes.data?.questions_answered ?? 0,
    hasStreakShield: (shieldRes.data?.length ?? 0) > 0,
  };
}

export function useStreakInfo(userId: string | undefined) {
  const { data, error, isLoading } = useSWR(
    userId ? `streak-info/${userId}` : null,
    () => fetchStreakInfo(userId!),
    { revalidateOnFocus: true, dedupingInterval: 10000, keepPreviousData: true }
  );

  return { streakInfo: data ?? null, error, isLoading };
}
