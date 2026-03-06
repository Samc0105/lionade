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
    }
  );

  return { stats: data ?? null, error, isLoading, mutate: boundMutate };
}

/** Imperatively revalidate stats (e.g. after quiz completion) */
export function mutateUserStats(userId: string) {
  return mutate(`user-stats/${userId}`);
}
