"use client";

import useSWR from "swr";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { normalizePlan, type MasteryPlan } from "@/lib/mastery-plan";

/**
 * Reads the signed-in user's subscription plan from `profiles.plan`.
 * Returns 'free' for signed-out users or when the column hasn't been
 * populated / migration 032 hasn't run — never throws, fail-closed.
 *
 * Uses SWR so the badge + gating UI stay fresh across tabs (a user who
 * upgrades in one tab should see the Pro badge appear in another on
 * focus).
 */

async function fetchPlan(userId: string): Promise<MasteryPlan> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .single();
    return normalizePlan((data as { plan?: string } | null)?.plan);
  } catch {
    return "free";
  }
}

export function usePlan(): {
  plan: MasteryPlan;
  isPaid: boolean;
  isLoading: boolean;
  refresh: () => void;
} {
  const { user } = useAuth();
  const { data, isLoading, mutate } = useSWR<MasteryPlan>(
    user?.id ? `plan/${user.id}` : null,
    () => fetchPlan(user!.id),
    { revalidateOnFocus: true, keepPreviousData: true },
  );
  const plan = data ?? "free";
  return {
    plan,
    isPaid: plan === "pro" || plan === "platinum",
    isLoading: !!user?.id && isLoading && !data,
    refresh: () => void mutate(),
  };
}
