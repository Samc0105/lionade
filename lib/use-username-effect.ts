"use client";

/**
 * useEquippedCosmetics — Shop V2 cosmetic resolver (2026-06-09)
 *
 * SWR hook for the LOGGED-IN user's CURRENTLY equipped cosmetics. Reads from
 * `GET /api/cosmetics/owned`, which (post backend fix) returns BOTH:
 *   - `items: [{ itemId, itemType, equipped }]`  (per-item ownership)
 *   - `equipped: { effect, frame, name_color, banner, avatar_aura }`
 *     (resolved equipped ids — the fast path this hook prefers)
 *
 * Defensive fallback chain (backend / migration may lag):
 *   1. `data.equipped.*`            (preferred — resolved ids)
 *   2. `data.items[].equipped`      (derive from the per-item list)
 *   3. null / "none"                (nothing equipped — renders plain)
 *
 * Scope: this is the SELF hook only. For OTHER users (leaderboard rows, party
 * players, friends) the calling surface passes the equipped values straight
 * from whatever the list API returns (equipped_frame / equipped_name_color /
 * equipped_avatar_aura / equipped_username_effect). We do NOT fan out a per-row
 * SWR cascade. Use the `resolveRow*` helpers below for those.
 *
 * `useEquippedUsernameEffect()` is preserved (delegates to the new hook) so all
 * existing callers keep working unchanged.
 */

import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/api-client";
import {
  resolveUsernameEffect,
  resolveNameColor,
  type UsernameEffect,
} from "@/components/AnimatedUsername";
import { pickTopFounderBadge } from "@/lib/cosmetics/badge-styles";

interface OwnedCosmetic {
  // Backend uses `itemId` / `itemType`; tolerate legacy `id` / `type` too.
  itemId?: string;
  itemType?: string;
  id?: string;
  type?: string;
  equipped?: boolean;
  effect?: string;
}

interface EquippedResolved {
  effect?: string | null;
  frame?: string | null;
  name_color?: string | null;
  banner?: string | null;
  avatar_aura?: string | null;
}

interface OwnedResponse {
  items?: OwnedCosmetic[];
  equipped?: EquippedResolved;
}

export interface EquippedCosmetics {
  effect: UsernameEffect;
  nameColor: string | null;
  frame: string | null;
  aura: string | null;
  banner: string | null;
  // Auto-selected highest-rarity owned FOUNDER badge id (Shop V2 flair pill).
  // null = none owned. Not slot-equipped; surfaced for display only.
  flair: string | null;
}

const EMPTY: EquippedCosmetics = {
  effect: "none",
  nameColor: null,
  frame: null,
  aura: null,
  banner: null,
  flair: null,
};

function itemId(c: OwnedCosmetic): string {
  return c.itemId ?? c.id ?? "";
}
function itemType(c: OwnedCosmetic): string {
  return c.itemType ?? c.type ?? "";
}

/** Normalize a possibly-null id, treating "" / "none" as not-equipped. */
function normId(v: string | null | undefined): string | null {
  if (!v || v === "none") return null;
  return v;
}

export function useEquippedCosmetics(): EquippedCosmetics {
  const { user } = useAuth();
  const key = user?.id ? `cosmetics-owned/${user.id}` : null;

  const { data } = useSWR(
    key,
    () => apiGet<OwnedResponse>("/api/cosmetics/owned"),
    {
      dedupingInterval: 60_000,
      keepPreviousData: true,
      revalidateOnFocus: true,
      // If the endpoint 404s while backend is in flight, return EMPTY — no crash.
      shouldRetryOnError: false,
    },
  );

  if (!data?.ok || !data.data) return EMPTY;
  const payload = data.data;

  // Flair: auto-pick the highest-rarity owned founder badge from the items
  // list (present in both response paths). Display-only; no equip slot.
  const flair = pickTopFounderBadge(
    (payload.items ?? [])
      .filter((c) => itemType(c) === "founder_badge")
      .map((c) => itemId(c))
      .filter(Boolean),
  );

  // ── Preferred path: the resolved `equipped` object ──
  const eq = payload.equipped;
  if (eq) {
    const effectRaw =
      normId(eq.effect)?.replace(/^name_fx_/, "").replace(/_premium$/, "") ?? null;
    return {
      effect: resolveUsernameEffect(effectRaw),
      nameColor: resolveNameColor(normId(eq.name_color)),
      frame: normId(eq.frame),
      aura: normId(eq.avatar_aura),
      banner: normId(eq.banner),
      flair,
    };
  }

  // ── Fallback: derive from the per-item ownership list ──
  if (!payload.items) return EMPTY;
  const equippedItems = payload.items.filter((c) => c.equipped === true);
  if (equippedItems.length === 0) return EMPTY;

  const byType = (t: string) => equippedItems.find((c) => itemType(c) === t);

  const effectItem = byType("username_effect");
  const effectRaw = effectItem
    ? (effectItem.effect ??
        itemId(effectItem).replace(/^name_fx_/, "").replace(/_premium$/, ""))
    : null;

  const nameItem = byType("name_color");
  // Banner can be `banner` or `animated_banner`.
  const bannerItem =
    byType("banner") ?? byType("animated_banner");
  const frameItem = byType("frame");
  const auraItem = byType("avatar_aura");

  return {
    effect: resolveUsernameEffect(effectRaw),
    nameColor: resolveNameColor(nameItem ? itemId(nameItem) : null),
    frame: frameItem ? normId(itemId(frameItem)) : null,
    aura: auraItem ? normId(itemId(auraItem)) : null,
    banner: bannerItem ? normId(itemId(bannerItem)) : null,
    flair,
  };
}

/**
 * Preserved legacy export — delegates to the new hook so existing callers
 * (profile header, leaderboard self-row, etc.) keep working unchanged.
 */
export function useEquippedUsernameEffect(): UsernameEffect {
  return useEquippedCosmetics().effect;
}

/**
 * Resolve a per-row username effect supplied by a list API (leaderboard /
 * friends / party). Pure; safe in render. Unknown → "none".
 */
export function resolveRowUsernameEffect(value: unknown): UsernameEffect {
  return resolveUsernameEffect(value);
}

/**
 * Resolve a per-row name-color id supplied by a list API. Pure; safe in render.
 * Unknown / empty → null.
 */
export function resolveRowNameColor(value: unknown): string | null {
  return resolveNameColor(value);
}
