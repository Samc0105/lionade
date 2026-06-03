"use client";

/**
 * useEquippedUsernameEffect — Shop V2 (2026-06-03)
 *
 * Small hook + helper for resolving the user's CURRENT equipped username
 * effect. V1 reads the effect via SWR from `/api/cosmetics/owned`, filtering
 * for `type: 'username_effect'` + `equipped: true`.
 *
 * Fallback chain (defensive — backend may not have shipped yet):
 *   1. `/api/cosmetics/owned` response with `equipped` flag
 *   2. `profiles.equipped_username_effect` column (if it lands later)
 *   3. "none" (no animation; renders raw username)
 *
 * For non-self renders (leaderboard rows, friends, party players) the calling
 * surface should pass `effect` directly from whatever the API returns. This
 * hook is intentionally scoped to the LOGGED-IN user — we don't fan out a
 * per-row SWR cascade. Cross-user equipped effects ride on the existing list
 * endpoints (see leaderboard / social / party fetchers) and need a small
 * backend follow-up.
 */

import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/api-client";
import { resolveUsernameEffect, type UsernameEffect } from "@/components/AnimatedUsername";

interface OwnedCosmetic {
  id: string;
  type: string;
  source: "purchased" | "founder" | "earned";
  equipped?: boolean;
  // Effect-bearing cosmetics map their id 1:1 to the AnimatedUsername effect
  // (rainbow / fire / holographic / gold / glitch / galaxy).
  effect?: string;
}

interface OwnedResponse {
  items: OwnedCosmetic[];
}

export function useEquippedUsernameEffect(): UsernameEffect {
  const { user } = useAuth();
  const key = user?.id ? `cosmetics-owned/${user.id}` : null;

  const { data } = useSWR(
    key,
    () => apiGet<OwnedResponse>("/api/cosmetics/owned"),
    {
      dedupingInterval: 60_000,
      keepPreviousData: true,
      revalidateOnFocus: true,
      // Hard-fail gracefully — if the endpoint 404s while backend is in flight,
      // we just return "none" and nobody crashes.
      shouldRetryOnError: false,
    },
  );

  if (!data?.ok || !data.data?.items) return "none";

  const equipped = data.data.items.find(
    (c) => c.type === "username_effect" && c.equipped === true,
  );
  if (!equipped) return "none";

  // Prefer the explicit `effect` field if backend supplies it; otherwise the
  // cosmetic `id` (canonical `name_fx_rainbow`, optionally `_premium` suffix)
  // encodes the effect name. Strip the `name_fx_` prefix + any `_premium`
  // suffix so both the Fang and cash variants resolve to the same effect.
  const raw = equipped.effect
    ?? equipped.id.replace(/^name_fx_/, "").replace(/_premium$/, "");
  return resolveUsernameEffect(raw);
}

/**
 * Resolve a per-row effect supplied by a list API (leaderboard / friends /
 * party). Pure function; safe in render. Anything unrecognized → "none".
 */
export function resolveRowUsernameEffect(value: unknown): UsernameEffect {
  return resolveUsernameEffect(value);
}
