"use client";

/**
 * CosmeticLocker — profile "manage my looks" surface (2026-06-11)
 *
 * One place for the OWNER to equip / unequip every owned cosmetic with a live
 * preview. Until now equipping only happened inside the shop; this is the
 * dedicated personalization locker on the profile.
 *
 * Data source: GET /api/cosmetics/owned (shared SWR key `cosmetics-owned/{id}`
 * — the SAME key useEquippedCosmetics reads). Equipping mutates that key so the
 * profile hero (which renders from useEquippedCosmetics) updates live alongside
 * the locker. No second source of truth.
 *
 * Equip flow: POST /api/me/equip { slot, cosmetic_id }. This is the canonical
 * slot-based endpoint the shop uses for username effects — it verifies
 * ownership across user_inventory + earned_cosmetics + founder_grants (so
 * earned / founder cosmetics equip too, unlike /api/shop/equip which only
 * knows purchased items), writes the profiles.equipped_* columns (the render
 * source of truth), is single-equipped-per-slot, and supports unequip via an
 * empty cosmetic_id. We use it for ALL slots so behavior matches the
 * profiles-column model the shop writes to.
 *
 * Scope: SELF only. The caller must gate this to the owner's own profile.
 *
 * Visuals: dark interstellar glass, gold/purple/electric accents, GPU-only +
 * reduced-motion safe (animation lives in Avatar / AnimatedUsername / banner
 * styles, all already reduced-motion safe in globals.css). No new packages.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  COSMETIC_ITEMS,
  AVATAR_AURAS,
  USERNAME_EFFECTS,
  ANIMATED_BANNERS,
  type ShopItem as CoreShopItem,
} from "@lionade/core/constants/shop-catalog";
import { apiGet, apiPost } from "@/lib/api-client";
import { getBannerStyle } from "@/lib/cosmetics/cosmetic-styles";
import Avatar from "@/components/Avatar";
import AnimatedUsername, { type UsernameEffect } from "@/components/AnimatedUsername";
import { toastError, toastSuccess } from "@/lib/toast";
import { Sparkle, Storefront, Check } from "@phosphor-icons/react";

// ── Owned-item contract (mirror of useEquippedCosmetics' tolerance) ──
interface OwnedItem {
  itemId?: string;
  itemType?: string;
  id?: string;
  type?: string;
  equipped?: boolean;
}
interface EquippedResolved {
  effect?: string | null;
  frame?: string | null;
  name_color?: string | null;
  banner?: string | null;
  avatar_aura?: string | null;
}
interface OwnedResponse {
  items?: OwnedItem[];
  equipped?: EquippedResolved;
}

function oId(c: OwnedItem): string {
  return c.itemId ?? c.id ?? "";
}
function oType(c: OwnedItem): string {
  return c.itemType ?? c.type ?? "";
}

// ── Catalog resolution: id -> display name (and which slot it belongs to) ──
// Banners union the static `banner` set + animated banners; both occupy the
// single banner slot server-side (equipped_banner).
const CATALOG_BY_ID: Record<string, CoreShopItem> = {};
for (const i of [...COSMETIC_ITEMS, ...AVATAR_AURAS, ...USERNAME_EFFECTS, ...ANIMATED_BANNERS]) {
  CATALOG_BY_ID[i.id] = i;
}

// Map a username_effect catalog id -> the AnimatedUsername effect token.
const EFFECT_TOKEN: Record<string, UsernameEffect> = {
  name_fx_rainbow: "rainbow",
  name_fx_fire: "fire",
  name_fx_holographic: "holographic",
  name_fx_gold: "gold",
  name_fx_glitch: "glitch",
  name_fx_galaxy: "galaxy",
};

// ── Slot definitions ──
// Each slot maps to a /api/me/equip slot string + the owned itemType(s) that
// belong to it. Banners accept both `banner` and `animated_banner`.
type SlotKey = "frame" | "avatar_aura" | "name_color" | "banner" | "username_effect";
interface SlotDef {
  key: SlotKey;
  label: string;
  // owned itemType strings that route into this slot
  types: string[];
  // empty-state CTA target inside the shop
  emptyCta: string;
}
const SLOTS: SlotDef[] = [
  { key: "frame", label: "Frames", types: ["frame"], emptyCta: "Browse frames in the shop" },
  { key: "avatar_aura", label: "Auras", types: ["avatar_aura"], emptyCta: "Browse auras in the shop" },
  { key: "name_color", label: "Name Colors", types: ["name_color"], emptyCta: "Browse name colors in the shop" },
  { key: "banner", label: "Banners", types: ["banner", "animated_banner"], emptyCta: "Browse banners in the shop" },
  { key: "username_effect", label: "Username Effects", types: ["username_effect"], emptyCta: "Browse username effects in the shop" },
];

// ── Resolve the equipped id for a slot from the `equipped` payload ──
function equippedIdForSlot(eq: EquippedResolved | undefined, slot: SlotKey): string | null {
  if (!eq) return null;
  const raw =
    slot === "frame" ? eq.frame :
    slot === "avatar_aura" ? eq.avatar_aura :
    slot === "name_color" ? eq.name_color :
    slot === "banner" ? eq.banner :
    eq.effect;
  if (!raw || raw === "none") return null;
  return raw;
}

export default function CosmeticLocker({ username }: { username: string }) {
  // Use the SHARED hero SWR key (`cosmetics-owned/{user.id}`) so a single
  // mutate keeps both the locker AND the profile hero (useEquippedCosmetics) in
  // lockstep — no second source of truth.
  const { user } = useAuth();
  const sharedKey = user?.id ? `cosmetics-owned/${user.id}` : null;

  const { data, mutate } = useSWR(
    sharedKey,
    () => apiGet<OwnedResponse>("/api/cosmetics/owned"),
    { dedupingInterval: 60_000, keepPreviousData: true, revalidateOnFocus: true, shouldRetryOnError: false },
  );

  const payload: OwnedResponse | null = data?.ok ? (data.data ?? null) : null;
  const items: OwnedItem[] = payload?.items ?? [];
  const equipped = payload?.equipped;

  // Optimistic per-slot equipped id (overrides server value until revalidation
  // catches up). null in the map = no override; "" means "intentionally none".
  const [optimistic, setOptimistic] = useState<Partial<Record<SlotKey, string | null>>>({});
  const [busySlot, setBusySlot] = useState<SlotKey | null>(null);

  // Resolved equipped id per slot (optimistic wins over server).
  const equippedFor = (slot: SlotKey): string | null => {
    if (slot in optimistic) return optimistic[slot] ?? null;
    return equippedIdForSlot(equipped, slot);
  };

  // Owned items grouped per slot.
  const grouped = useMemo(() => {
    const out: Record<SlotKey, OwnedItem[]> = {
      frame: [], avatar_aura: [], name_color: [], banner: [], username_effect: [],
    };
    for (const it of items) {
      const t = oType(it);
      const slot = SLOTS.find((s) => s.types.includes(t));
      if (slot) out[slot.key].push(it);
    }
    return out;
  }, [items]);

  const handleToggle = async (slot: SlotKey, itemId: string) => {
    if (busySlot) return;
    const currently = equippedFor(slot);
    const next = currently === itemId ? "" : itemId; // toggle: same item => unequip
    // Optimistic: reflect immediately on locker + hero (shared SWR cache).
    setOptimistic((m) => ({ ...m, [slot]: next }));
    setBusySlot(slot);
    // Optimistically patch the shared cache so the hero updates without a flash.
    await mutate(
      (cur) => {
        if (!cur?.ok || !cur.data) return cur;
        const col =
          slot === "frame" ? "frame" :
          slot === "avatar_aura" ? "avatar_aura" :
          slot === "name_color" ? "name_color" :
          slot === "banner" ? "banner" : "effect";
        const nextEquipped = { ...(cur.data.equipped ?? {}), [col]: next || null };
        const nextItems = (cur.data.items ?? []).map((it) => {
          const t = oType(it);
          const inSlot = SLOTS.find((s) => s.key === slot)?.types.includes(t);
          if (!inSlot) return it;
          return { ...it, equipped: oId(it) === next };
        });
        return { ...cur, data: { ...cur.data, equipped: nextEquipped, items: nextItems } };
      },
      { revalidate: false },
    );

    const res = await apiPost("/api/me/equip", { slot, cosmetic_id: next });
    if (!res.ok) {
      toastError("Couldn't update that. Try again shortly.");
      // Roll back optimistic state + refetch server truth.
      setOptimistic((m) => {
        const { [slot]: _drop, ...rest } = m;
        return rest;
      });
      await mutate();
      setBusySlot(null);
      return;
    }
    toastSuccess(next ? "Equipped" : "Unequipped");
    // Revalidate against server truth, but only drop the optimistic override
    // once the freshly-fetched payload actually reflects the new value. The
    // equip POST can have read-after-write lag; clearing the override before
    // the server agrees would briefly revert the card + hero. We keep the
    // optimistic key until the revalidated payload matches, so there is no
    // visible flicker on success. (Rollback-on-failure is handled above.)
    const fresh = await mutate();
    const freshEquipped = fresh?.ok ? fresh.data?.equipped : undefined;
    const want = next || null;
    const serverReflects = (equippedIdForSlot(freshEquipped, slot) ?? null) === (want === "" ? null : want);
    if (serverReflects) {
      setOptimistic((m) => {
        const { [slot]: _drop, ...rest } = m;
        return rest;
      });
    }
    // If the server hasn't caught up yet, leave the optimistic override in
    // place; the next revalidateOnFocus / dedupe-window refetch will converge
    // it to the (now-matching) server truth without a revert.
    setBusySlot(null);
  };

  return (
    <div className="space-y-6">
      {SLOTS.map((slot) => {
        const owned = grouped[slot.key];
        const equippedId = equippedFor(slot.key);
        return (
          <section
            key={slot.key}
            aria-labelledby={`locker-slot-${slot.key}`}
            className="rounded-2xl border border-electric/20 p-5"
            style={{ background: "var(--sidebar-bg)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id={`locker-slot-${slot.key}`} className="font-bebas text-xl text-cream tracking-wider">{slot.label}</h3>
              {owned.length > 0 && (
                <span className="text-cream/40 text-[11px] font-mono uppercase tracking-[0.18em]">
                  {owned.length} owned
                </span>
              )}
            </div>

            {owned.length === 0 ? (
              <div className="text-center py-7 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="w-11 h-11 mx-auto mb-3 rounded-full flex items-center justify-center border border-purple-400/20 bg-purple-400/5">
                  <Sparkle size={20} weight="regular" color="rgba(168,85,247,0.7)" aria-hidden="true" />
                </div>
                <p className="text-cream/50 text-sm mb-3">None owned yet</p>
                <Link
                  href="/shop"
                  className="inline-flex items-center gap-1.5 min-h-[44px] font-syne font-semibold text-xs px-4 py-2.5 rounded-full border border-electric/30 text-electric hover:bg-electric/10 transition-colors"
                >
                  <Storefront size={13} weight="fill" aria-hidden="true" /> {slot.emptyCta}
                </Link>
              </div>
            ) : (
              <div role="list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {owned.map((it) => {
                  const id = oId(it);
                  const meta = CATALOG_BY_ID[id];
                  const name = meta?.name ?? id;
                  const isEquipped = equippedId === id;
                  const busy = busySlot === slot.key;
                  return (
                    <div
                      key={id}
                      role="listitem"
                      className="rounded-xl p-3 flex flex-col gap-3 transition-colors"
                      style={{
                        background: isEquipped
                          ? "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.03))"
                          : "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
                        border: isEquipped
                          ? "1px solid rgba(34,197,94,0.45)"
                          : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      {/* Live preview */}
                      <div className="flex items-center justify-center min-h-[64px] rounded-lg bg-black/20 py-3 px-2 overflow-hidden">
                        <LockerPreview slot={slot.key} itemId={id} username={username} />
                      </div>

                      {/* Name + toggle */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bebas text-base text-cream tracking-wide truncate">
                          {name}
                        </span>
                        {isEquipped && (
                          <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
                            <Check size={10} weight="bold" aria-hidden="true" /> On
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleToggle(slot.key, id)}
                        disabled={busy}
                        aria-pressed={isEquipped}
                        aria-label={isEquipped ? `${name} equipped, tap to unequip` : `Equip ${name}`}
                        className={`w-full min-h-[44px] py-2.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${
                          isEquipped
                            ? "border border-green-500/40 text-green-400 hover:bg-green-500/10"
                            : "border border-electric/30 text-electric hover:bg-electric/10"
                        }`}
                      >
                        {isEquipped ? "Unequip" : "Equip"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ── Per-slot live preview ──
// Mirrors the shop's preview approach: <Avatar> for frame/aura, AnimatedUsername
// for name color/effect, a gradient swatch for banners.
function LockerPreview({
  slot,
  itemId,
  username,
}: {
  slot: SlotKey;
  itemId: string;
  username: string;
}) {
  if (slot === "frame" || slot === "avatar_aura") {
    return (
      <Avatar
        url={`https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`}
        alt=""
        size="md"
        frame={slot === "frame" ? itemId : null}
        aura={slot === "avatar_aura" ? itemId : null}
      />
    );
  }
  if (slot === "name_color") {
    return (
      <AnimatedUsername
        username={username}
        effect="none"
        nameColor={itemId}
        size="lg"
        className="font-bebas text-2xl tracking-wider"
      />
    );
  }
  if (slot === "username_effect") {
    return (
      <AnimatedUsername
        username={username}
        effect={EFFECT_TOKEN[itemId] ?? "none"}
        size="lg"
        className="font-bebas text-2xl tracking-wider"
      />
    );
  }
  // banner — gradient / pattern swatch (same source the hero strip uses)
  const banner = getBannerStyle(itemId);
  return (
    <div
      className={`w-full h-12 rounded-md ${banner.animClass ?? ""}`}
      style={{ background: banner.background, backgroundSize: banner.backgroundSize }}
      aria-hidden="true"
    />
  );
}
