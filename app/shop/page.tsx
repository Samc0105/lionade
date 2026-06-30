"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCoins } from "@/lib/mockData";
import { cdnUrl } from "@/lib/cdn";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";
import DailySpinHero from "@/components/Shop/DailySpinHero";
import FeatureGate from "@/components/FeatureGate";
import Avatar from "@/components/Avatar";
import AnimatedUsername, { type UsernameEffect } from "@/components/AnimatedUsername";
import {
  getFrameStyle,
  getAuraStyle,
  getNameColorStyle,
  BANNER_STYLES,
} from "@/lib/cosmetics/cosmetic-styles";
import { todaysDrops as pickTodaysDrops } from "@/lib/shop-daily-drops";
import {
  COSMETIC_ITEMS as CORE_COSMETIC_ITEMS,
  BOOSTER_ITEMS as CORE_BOOSTER_ITEMS,
  AVATAR_AURAS as CORE_AVATAR_AURAS,
  VOICE_SKINS as CORE_VOICE_SKINS,
  USERNAME_EFFECTS as CORE_USERNAME_EFFECTS,
  ANIMATED_BANNERS as CORE_ANIMATED_BANNERS,
  FEATURED_ITEMS as CORE_FEATURED_ITEMS,
  type ShopItem as CoreShopItem,
} from "@lionade/core/constants/shop-catalog";
import type { ComponentType } from "react";
import type { IconProps } from "@phosphor-icons/react";
import {
  PawPrint,
  Coins,
  Rainbow,
  Circle,
  Fire,
  Diamond,
  Snowflake,
  Heart,
  Flag,
  Sword,
  Sparkle,
  Crown,
  Lightning,
  Shield,
  DiceFive,
  Leaf,
  TrendUp,
  DiamondsFour,
  Star,
  Sphere,
  Medal,
  Flame,
  CircleNotch,
  Check,
  Rocket,
  Backpack,
  Bank,
  Palette,
  Lock,
  Image as ImageIcon,
  FlagBanner,
  StarFour,
} from "@phosphor-icons/react";

// ── Types ──
type Rarity = "common" | "rare" | "epic" | "legendary";
// Mirror of the canonical ItemType / BoosterEffect unions
// (packages/lionade-core/src/constants/shop-catalog.ts) so items DERIVED from
// the catalog (which now drives id/name/type/rarity/price) type-check here.
type ItemType = "frame" | "background" | "name_color" | "banner" | "booster" | "avatar_aura" | "voice_skin" | "username_effect" | "animated_banner" | "founder_badge" | "earned_medal" | "profile_flair";
type BoosterEffect = "coin_multiplier" | "xp_multiplier" | "coin_xp_multiplier" | "extra_time" | "auto_correct" | "fifty_fifty" | "score_boost" | "streak_shield" | "mastery_hint";
type Tab = "featured" | "cosmetics" | "boosters" | "inventory";
type PremiumTab = "themes" | "frames" | "name_colors" | "banners";
type CosmeticSub = "frames" | "backgrounds" | "name_colors" | "banners";
type StoreMode = "coins" | "premium";
type PhosphorIcon = ComponentType<IconProps>;

interface ShopItem {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  rarity: Rarity;
  price: number;
  Icon: PhosphorIcon;
  iconWeight?: IconProps["weight"];
  iconColor?: string;
  preview?: string;
  boosterEffect?: BoosterEffect;
  boosterValue?: number;
  boosterDuration?: number;
  // Shop overhaul (2026-06-09) — visible-but-locked. The renderer shows a
  // muted "Soon" pill + disabled buy; the server also blocks the purchase.
  comingSoon?: boolean;
  // Optional custom art (public/shop/*.png) rendered in the icon slot instead
  // of the Phosphor fallback — used for the coming-soon teasers.
  previewImg?: string;
}

interface PremiumItem {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  rarity: Rarity;
  priceUSD: number;
  Icon: PhosphorIcon;
  iconWeight?: IconProps["weight"];
  iconColor?: string;
}

interface OwnedItem {
  itemId: string;
  quantity: number;
  equipped: boolean;
  acquiredAt: string;
}

// ── Rarity config ──
// Whole-surface tier tinting (2026-06-05) — every shop card reads its tier from
// across the room, not just from a 10px badge in the corner. Same pattern as
// Word Banks (confidence-tinted rows) + Sketchy (difficulty-tinted picker).
//
// cardBg: 135° tier wash STACKED on top of the near-black card base so it still
//   feels like a shop card, not a color card. Top-left is the bright stop, BR
//   fades almost to base. 12% (common) → 24% (legendary).
// cardBorder: tier color at 45→65% opacity. Replaces the old `border-{tier}-500/40`
//   class which was effectively invisible against the new wash.
// cardShadow: tier-colored outer glow, modest. Layered with the EXISTING pulsing
//   `shop-glow-*` keyframe class (which animates a stronger pulse on top).
// accentLine: 2px left-edge stripe color (Word Bank pattern) for an extra anchor.
//
// Legacy `border` / `glow` / `bg` / `text` / `badge` kept for back-compat at sites
// not yet migrated (none today — all 10 sites migrated this pass).
const RARITY_COLORS: Record<Rarity, {
  border: string; glow: string; bg: string; text: string; badge: string;
  cardBg: string; cardBorder: string; cardShadow: string; accentLine: string;
}> = {
  common: {
    border: "border-gray-500/40", glow: "shop-glow-common", bg: "bg-gray-500/8",
    text: "text-gray-400", badge: "bg-gray-500/20 text-gray-300",
    cardBg: "linear-gradient(135deg, rgba(156,163,175,0.12), rgba(156,163,175,0.04)), linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))",
    cardBorder: "rgba(156,163,175,0.45)",
    cardShadow: "0 0 12px rgba(156,163,175,0.10)",
    accentLine: "rgba(156,163,175,0.55)",
  },
  rare: {
    border: "border-blue-500/40", glow: "shop-glow-rare", bg: "bg-blue-500/8",
    text: "text-blue-400", badge: "bg-blue-500/20 text-blue-300",
    cardBg: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(59,130,246,0.06)), linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))",
    cardBorder: "rgba(59,130,246,0.55)",
    cardShadow: "0 0 18px rgba(59,130,246,0.18)",
    accentLine: "rgba(59,130,246,0.75)",
  },
  epic: {
    border: "border-purple-500/40", glow: "shop-glow-epic", bg: "bg-purple-500/8",
    text: "text-purple-400", badge: "bg-purple-500/20 text-purple-300",
    cardBg: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(168,85,247,0.07)), linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))",
    cardBorder: "rgba(168,85,247,0.60)",
    cardShadow: "0 0 22px rgba(168,85,247,0.22)",
    accentLine: "rgba(168,85,247,0.85)",
  },
  legendary: {
    border: "border-yellow-500/40", glow: "shop-glow-legendary", bg: "bg-yellow-500/8",
    text: "text-yellow-400", badge: "bg-yellow-500/20 text-yellow-300",
    cardBg: "linear-gradient(135deg, rgba(255,215,0,0.24), rgba(255,165,0,0.10)), linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))",
    cardBorder: "rgba(255,215,0,0.65)",
    cardShadow: "0 0 28px rgba(255,215,0,0.28)",
    accentLine: "rgba(255,215,0,0.95)",
  },
};

// ══════════════════════════════════════════
// ── Coin Store Items — DERIVED FROM THE CANONICAL CATALOG ──
// ══════════════════════════════════════════
// 2026-06-11 data-integrity fix: this page used to carry its OWN hardcoded item
// arrays whose prices + ids had DRIFTED from the canonical catalog at
// packages/lionade-core/src/constants/shop-catalog.ts (the same file the server
// reads via getShopItem). The shop showed cheap stale prices + orphan ids
// (aura_aurora/rose/amber/frost/ember, ninny_voice_skin, mastery_hint_pack)
// that either undercharged the user or failed server purchase outright.
//
// Now the catalog is the SINGLE SOURCE OF TRUTH for id/name/description/type/
// rarity/price. The only thing that lives locally is DISPLAY CHROME — the
// Phosphor Icon + weight + color + a comingSoon flag — which the catalog
// (emoji-only) does not carry. We merge { ...canonicalItem, ...chromeFor(id) }
// so the displayed price ALWAYS equals the canonical/server price.

// ── Per-id display chrome ──
// Keyed by canonical item id. Anything without an explicit entry falls back to
// a rarity-tinted generic icon (chromeFor) so nothing ever renders iconless.
interface ItemChrome {
  Icon: PhosphorIcon;
  iconWeight?: IconProps["weight"];
  iconColor?: string;
  // visible-but-locked. Server ALSO blocks these with "This item is coming
  // soon" (voice_ninny_classic + boost_mastery_hint_pack), so we never let the
  // user click Buy and hit a server error.
  comingSoon?: boolean;
  // Custom art shown in the icon slot for coming-soon teasers (public/shop/*.png).
  previewImg?: string;
}

const ITEM_CHROME: Record<string, ItemChrome> = {
  // Frames
  frame_basic_blue: { Icon: Circle, iconWeight: "fill", iconColor: "#4A90D9" },
  frame_fire: { Icon: Fire, iconWeight: "fill", iconColor: "#F97316" },
  frame_crystal: { Icon: Diamond, iconWeight: "fill", iconColor: "#A855F7" },
  frame_golden_lion: { Icon: PawPrint, iconWeight: "fill", iconColor: "#FFD700" },
  // Name colors
  name_ice: { Icon: Snowflake, iconWeight: "regular", iconColor: "#7DD3FC" },
  name_emerald: { Icon: Heart, iconWeight: "fill", iconColor: "#22C55E" },
  name_amethyst: { Icon: Heart, iconWeight: "fill", iconColor: "#A855F7" },
  name_aurora: { Icon: Rainbow, iconWeight: "fill" },
  // Banners (original set)
  banner_starter: { Icon: Flag, iconWeight: "regular", iconColor: "#94A3B8" },
  banner_warrior: { Icon: Sword, iconWeight: "fill", iconColor: "#60A5FA" },
  banner_galaxy: { Icon: Sparkle, iconWeight: "fill", iconColor: "#A855F7" },
  banner_legend: { Icon: Crown, iconWeight: "fill", iconColor: "#FFD700" },
  // Boosters
  boost_coin_rush: { Icon: Coins, iconWeight: "fill", iconColor: "#FFD700" },
  boost_xp_surge: { Icon: Lightning, iconWeight: "fill", iconColor: "#FACC15" },
  boost_streak_shield: { Icon: Shield, iconWeight: "fill", iconColor: "#A855F7" },
  boost_double_down: { Icon: DiceFive, iconWeight: "regular", iconColor: "#A855F7" },
  boost_lucky_start: { Icon: Leaf, iconWeight: "fill", iconColor: "#22C55E" },
  boost_time_warp: { Icon: CircleNotch, iconWeight: "bold", iconColor: "#94A3B8" },
  boost_brain_freeze: { Icon: Snowflake, iconWeight: "regular", iconColor: "#7DD3FC" },
  boost_score_boost: { Icon: TrendUp, iconWeight: "regular", iconColor: "#94A3B8" },
  // Server blocks this one ("coming soon") — surface as locked, never buyable.
  boost_mastery_hint_pack: { Icon: Lightning, iconWeight: "fill", iconColor: "#FACC15", previewImg: "/shop/mastery-hint-pack.png" },
  boost_streak_shield_3pack: { Icon: Shield, iconWeight: "fill", iconColor: "#A855F7" },
  // Avatar auras (canonical ids)
  aura_solar: { Icon: Sphere, iconWeight: "fill", iconColor: "#FACC15" },
  aura_lunar: { Icon: StarFour, iconWeight: "fill", iconColor: "#E8EAF2" },
  aura_emerald: { Icon: Heart, iconWeight: "fill", iconColor: "#22C55E" },
  aura_sapphire: { Icon: Diamond, iconWeight: "fill", iconColor: "#3B82F6" },
  aura_ruby: { Icon: Circle, iconWeight: "fill", iconColor: "#EF4444" },
  aura_amethyst: { Icon: Sphere, iconWeight: "fill", iconColor: "#A855F7" },
  aura_storm: { Icon: Lightning, iconWeight: "fill", iconColor: "#60A5FA" },
  aura_inferno: { Icon: Flame, iconWeight: "fill", iconColor: "#F97316" },
  aura_void: { Icon: CircleNotch, iconWeight: "bold", iconColor: "#A855F7" },
  aura_prismatic: { Icon: Rainbow, iconWeight: "fill", iconColor: "#A855F7" },
  // Voice skin — server blocks ("coming soon"), surface as locked.
  voice_ninny_classic: { Icon: Sparkle, iconWeight: "fill", iconColor: "#A855F7", comingSoon: true, previewImg: "/shop/voice-ninny-classic.png" },
  // Username effects
  name_fx_rainbow: { Icon: Rainbow, iconWeight: "fill" },
  name_fx_fire: { Icon: Fire, iconWeight: "fill", iconColor: "#F97316" },
  name_fx_holographic: { Icon: Sphere, iconWeight: "fill", iconColor: "#A855F7" },
  name_fx_gold: { Icon: Medal, iconWeight: "fill", iconColor: "#FFD700" },
  name_fx_glitch: { Icon: Lightning, iconWeight: "fill", iconColor: "#60A5FA" },
  name_fx_galaxy: { Icon: Sparkle, iconWeight: "fill", iconColor: "#A855F7" },
  // Animated banners (premium Fang banners)
  banner_interstellar: { Icon: Sparkle, iconWeight: "fill" },
  banner_aurora: { Icon: Rainbow, iconWeight: "fill", iconColor: "#22D3EE" },
  banner_ink_splash: { Icon: CircleNotch, iconWeight: "bold", iconColor: "#94A3B8" },
  banner_honeycomb: { Icon: Diamond, iconWeight: "fill", iconColor: "#FACC15" },
  banner_tidewave: { Icon: Heart, iconWeight: "fill", iconColor: "#22C55E" },
};

// Rarity-tinted generic fallback so any catalog id without explicit chrome
// still renders an icon (never iconless).
const RARITY_ICON_COLOR: Record<Rarity, string> = {
  common: "#94A3B8",
  rare: "#60A5FA",
  epic: "#A855F7",
  legendary: "#FFD700",
};
function chromeFor(item: CoreShopItem): ItemChrome {
  return ITEM_CHROME[item.id] ?? { Icon: Sparkle, iconWeight: "fill", iconColor: RARITY_ICON_COLOR[item.rarity] };
}

// Merge a canonical catalog item with its display chrome. id/name/description/
// type/rarity/price + booster effect/value/duration ALL come from the catalog.
function toShopItem(item: CoreShopItem): ShopItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type as ItemType,
    rarity: item.rarity,
    price: item.price,
    boosterEffect: item.boosterEffect as BoosterEffect | undefined,
    boosterValue: item.boosterValue,
    boosterDuration: item.boosterDuration,
    ...chromeFor(item),
  };
}

const FEATURED_ITEMS: ShopItem[] = CORE_FEATURED_ITEMS.map(toShopItem);

const COSMETIC_ITEMS: ShopItem[] = CORE_COSMETIC_ITEMS.map(toShopItem);

const BOOSTER_ITEMS: ShopItem[] = CORE_BOOSTER_ITEMS.map(toShopItem);

// ══════════════════════════════════════════
// ── Premium Store Items ──
// ══════════════════════════════════════════

const PREMIUM_ITEMS: PremiumItem[] = [
  { id: "prem_frame_diamond", name: "Diamond Crown Frame", description: "An ultra-rare diamond-encrusted frame that radiates prestige", type: "frame", rarity: "legendary", priceUSD: 4.99, Icon: DiamondsFour, iconWeight: "fill", iconColor: "#FFD700" },
  { id: "prem_frame_neon", name: "Neon Pulse Frame", description: "Reactive neon border that pulses with energy", type: "frame", rarity: "epic", priceUSD: 2.99, Icon: Star, iconWeight: "fill", iconColor: "#A855F7" },
  { id: "prem_name_holo", name: "Holographic Name", description: "Holographic rainbow shift name effect", type: "name_color", rarity: "legendary", priceUSD: 1.99, Icon: Sphere, iconWeight: "regular", iconColor: "#FFD700" },
  { id: "prem_name_gold", name: "Solid Gold Name", description: "Pure gold name with metallic sheen", type: "name_color", rarity: "epic", priceUSD: 1.49, Icon: Medal, iconWeight: "fill", iconColor: "#FFD700" },
  { id: "prem_banner_phoenix", name: "Phoenix Rising", description: "Animated phoenix banner with particle trail", type: "banner", rarity: "legendary", priceUSD: 4.99, Icon: Flame, iconWeight: "fill", iconColor: "#F97316" },
  { id: "prem_banner_void", name: "Void Walker", description: "Dark energy void banner with lightning", type: "banner", rarity: "epic", priceUSD: 3.49, Icon: CircleNotch, iconWeight: "bold", iconColor: "#A855F7" },
  { id: "prem_frame_starfield", name: "Starfield Frame", description: "Animated stars orbiting your avatar", type: "frame", rarity: "rare", priceUSD: 1.99, Icon: StarFour, iconWeight: "fill", iconColor: "#60A5FA" },
  { id: "prem_banner_lightning", name: "Thunder Strike", description: "Crackling lightning bolt banner", type: "banner", rarity: "rare", priceUSD: 2.49, Icon: Lightning, iconWeight: "fill", iconColor: "#FACC15" },
  { id: "prem_name_fire", name: "Flame Name", description: "Burning flame text effect", type: "name_color", rarity: "rare", priceUSD: 0.99, Icon: Fire, iconWeight: "fill", iconColor: "#F97316" },
];

// ══════════════════════════════════════════
// ── Fang IAP Packs (2026-06-02) ──
// 4 real-money packs that mint Fangs via Stripe Checkout.
// POST /api/stripe/fang-purchase { packId } → { url } → redirect.
// Bonus = Fangs beyond the linear $0.99 → 5k baseline.
// ══════════════════════════════════════════
type FangPackId = "fangs_s" | "fangs_m" | "fangs_l" | "fangs_xl";
interface FangPack {
  id: FangPackId;
  name: string;
  fangs: number;
  priceUSD: number;
  bonus: number;
  bonusLabel: string;
  badge?: { label: string; tone: "best" | "mega" };
  accent: "default" | "value" | "mega";
}
const FANG_IAP_PACKS: FangPack[] = [
  { id: "fangs_s", name: "Starter Pack", fangs: 5_000, priceUSD: 0.99, bonus: 0, bonusLabel: "Baseline rate", accent: "default" },
  { id: "fangs_m", name: "Hustle Pack", fangs: 30_000, priceUSD: 4.99, bonus: 5_000, bonusLabel: "+5,000 bonus", accent: "default" },
  { id: "fangs_l", name: "Power Pack", fangs: 140_000, priceUSD: 19.99, bonus: 40_000, bonusLabel: "+40,000 bonus", badge: { label: "Best Value", tone: "best" }, accent: "value" },
  { id: "fangs_xl", name: "Pride Pack", fangs: 400_000, priceUSD: 49.99, bonus: 150_000, bonusLabel: "+150,000 bonus", badge: { label: "Mega Pack", tone: "mega" }, accent: "mega" },
];

// ══════════════════════════════════════════
// ── New shop SKUs — DERIVED FROM THE CANONICAL CATALOG ──
// ══════════════════════════════════════════
// The "New this week" row used to carry orphan ids (mastery_hint_pack,
// streak_shield_3pack, ninny_voice_skin) that did not exist server-side. Now
// pulled by canonical id so /api/shop/purchase resolves price + type. The
// catalog blocks voice_ninny_classic + boost_mastery_hint_pack as "coming
// soon" — their chrome carries comingSoon:true so the card shows the locked
// "Soon" treatment and never reaches a server error.
const NEW_SKUS: ShopItem[] = [
  CORE_BOOSTER_ITEMS.find((i) => i.id === "boost_mastery_hint_pack")!,
  CORE_BOOSTER_ITEMS.find((i) => i.id === "boost_streak_shield_3pack")!,
  CORE_VOICE_SKINS.find((i) => i.id === "voice_ninny_classic")!,
].map(toShopItem);

// 10 Avatar Auras rendered as a sub-grid under the "New this week" section.
const AVATAR_AURAS: ShopItem[] = CORE_AVATAR_AURAS.map(toShopItem);

// ══════════════════════════════════════════
// ── Shop V2 — Identity & Status Pack (2026-06-03) ──
// 18 new SKUs grouped by acquisition path:
//   - 6 animated username effects (Fang-purchasable)
//   - 5 premium Fang banners (Fang-purchasable, high price)
//   - 4 cash-premium banners (USD only)
//   - 3 founder badges (capped supply — server enforces)
//   - 4 earned cosmetics (NOT in shop — surfaced in Inventory only)
//
// Ids match the backend canonical list in
// packages/lionade-core/src/constants/shop-catalog.ts so /api/shop/purchase
// resolves price + type server-side. UI-only metadata lives here.
// ══════════════════════════════════════════
interface UsernameEffectSKU extends ShopItem {
  effect: UsernameEffect;
}
// The `effect` value the AnimatedUsername preview reads is derived from the
// canonical id: every username effect is `name_fx_<effect>`. id/name/price all
// come from the catalog.
const USERNAME_EFFECT_MAP: Record<string, UsernameEffect> = {
  name_fx_rainbow: "rainbow",
  name_fx_fire: "fire",
  name_fx_holographic: "holographic",
  name_fx_gold: "gold",
  name_fx_glitch: "glitch",
  name_fx_galaxy: "galaxy",
};
const USERNAME_EFFECTS: UsernameEffectSKU[] = CORE_USERNAME_EFFECTS.map((i) => ({
  ...toShopItem(i),
  effect: USERNAME_EFFECT_MAP[i.id] ?? "none",
}));

// 5 premium Fang banners (animated, high price, Fang-only) — derived from the
// canonical `animated_banner` entries so /api/shop/purchase resolves price +
// type server-side.
const PREMIUM_FANG_BANNERS: ShopItem[] = CORE_ANIMATED_BANNERS.map(toShopItem);

// 4 cash-premium banners (USD only — Stripe IAP)
const CASH_PREMIUM_BANNERS: PremiumItem[] = [
  { id: "prem_banner_eclipse",   name: "Eclipse",         description: "Ringed eclipse with corona shimmer",      type: "banner", rarity: "legendary", priceUSD: 5.99, Icon: Diamond,    iconWeight: "fill", iconColor: "#FFD700" },
  { id: "prem_banner_aurora_x",  name: "Aurora Pro",      description: "High-fidelity aurora with parallax stars",type: "banner", rarity: "legendary", priceUSD: 4.99, Icon: Rainbow,    iconWeight: "fill"                       },
  { id: "prem_banner_nebula",    name: "Nebula Drift",    description: "Drifting nebula with dust particles",     type: "banner", rarity: "epic",      priceUSD: 3.99, Icon: Sphere,     iconWeight: "fill", iconColor: "#A855F7" },
  { id: "prem_banner_chromium",  name: "Chromium",        description: "Reactive chrome surface that catches light",type: "banner", rarity: "epic",    priceUSD: 3.49, Icon: DiamondsFour,iconWeight: "fill", iconColor: "#E8EAF2" },
];

// 3 founder badges. These are NEVER bought with Fangs. Founding Scholar ships
// with a Pro subscription (auto-granted to the first 1,000 subscribers by the
// Stripe webhook); the other two are auto-granted by signup order / pre-launch
// activity. The ids MUST match the server catalog + founder_grants table
// (badge_*) or the owned-state and cap countdown silently never resolve — the
// previous `founder_*` ids matched nothing server-side, so every "Claim"
// button 404'd and the FOMO counter never rendered.
type FounderAcquire = "pro" | "auto";
interface FounderBadgeSKU {
  id: string;
  name: string;
  tagline: string;
  cap: number;
  showCap: boolean;        // render the "N of cap remaining" FOMO countdown
  acquire: FounderAcquire; // "pro" → Get-with-Pro CTA; "auto" → status only
  acquireNote: string;     // muted status line shown to non-owners
  Icon: PhosphorIcon;
  iconColor: string;
}
const FOUNDER_BADGES: FounderBadgeSKU[] = [
  { id: "badge_founding_scholar", name: "Founding Scholar", tagline: "First 1,000 Pro subscribers. Permanent.",  cap: 1000,   showCap: true,  acquire: "pro",  acquireNote: "Included with Pro",                       Icon: Medal, iconColor: "#FFD700" },
  { id: "badge_lionade_og",       name: "Lionade OG",       tagline: "First 500 signups. You were here first.",  cap: 500,    showCap: true,  acquire: "auto", acquireNote: "Auto-granted to the first 500 signups",   Icon: Crown, iconColor: "#FFD700" },
  { id: "badge_beta_witness",     name: "Beta Witness",     tagline: "Active before launch day.",                cap: 100000, showCap: false, acquire: "auto", acquireNote: "Granted to everyone active before launch", Icon: Star,  iconColor: "#A855F7" },
];

// ── Helpers ──
function getWeeklyCountdown() {
  const now = new Date();
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  nextMonday.setHours(0, 0, 0, 0);
  const diff = nextMonday.getTime() - now.getTime();
  return { days: Math.floor(diff / 86400000), hours: Math.floor((diff % 86400000) / 3600000) };
}

// ── Hero gold-drift particles ──
// Deterministic positions (no Math.random at render) so SSR + first client
// paint match. GPU-only (transform + opacity), respects prefers-reduced-motion
// via the .shop-hero-drift class in globals.css. 9 specks total — enough to
// feel alive, light enough to ignore on dial-up.
const HERO_DRIFT_SPECKS: Array<{ left: string; top: string; size: number; delay: string; duration: string; tone: "gold" | "purple" | "electric" }> = [
  { left: "6%",  top: "18%", size: 4, delay: "0s",   duration: "11s", tone: "gold" },
  { left: "14%", top: "62%", size: 3, delay: "1.3s", duration: "13s", tone: "purple" },
  { left: "22%", top: "32%", size: 5, delay: "2.7s", duration: "10s", tone: "gold" },
  { left: "36%", top: "78%", size: 3, delay: "0.6s", duration: "12s", tone: "electric" },
  { left: "48%", top: "22%", size: 4, delay: "3.4s", duration: "14s", tone: "gold" },
  { left: "62%", top: "70%", size: 3, delay: "1.9s", duration: "11s", tone: "purple" },
  { left: "74%", top: "30%", size: 5, delay: "2.2s", duration: "13s", tone: "gold" },
  { left: "84%", top: "60%", size: 4, delay: "0.9s", duration: "12s", tone: "electric" },
  { left: "92%", top: "26%", size: 3, delay: "3.0s", duration: "10s", tone: "gold" },
];
function HeroGoldDrift() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {HERO_DRIFT_SPECKS.map((s, i) => {
        const color = s.tone === "gold" ? "#FFD700" : s.tone === "purple" ? "#A855F7" : "#4A90D9";
        const glow = s.tone === "gold"
          ? "0 0 6px rgba(255,215,0,0.85), 0 0 12px rgba(255,215,0,0.45)"
          : s.tone === "purple"
            ? "0 0 6px rgba(168,85,247,0.75), 0 0 12px rgba(168,85,247,0.35)"
            : "0 0 6px rgba(74,144,217,0.75), 0 0 12px rgba(74,144,217,0.35)";
        return (
          <span
            key={i}
            className="absolute rounded-full shop-hero-drift"
            style={{
              left: s.left,
              top: s.top,
              width: `${s.size}px`,
              height: `${s.size}px`,
              background: color,
              boxShadow: glow,
              animationDelay: s.delay,
              animationDuration: s.duration,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Purchase particle burst ──
function PurchaseBurst({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  // Reduced motion: skip the particle layer entirely but still settle state
  // promptly so the parent flag clears.
  useEffect(() => { const t = setTimeout(onDone, reduce ? 150 : 1200); return () => clearTimeout(t); }, [onDone, reduce]);
  const particles = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * 360;
    const dist = 40 + Math.random() * 60;
    return { id: i, dx: Math.cos((angle * Math.PI) / 180) * dist, dy: Math.sin((angle * Math.PI) / 180) * dist, delay: Math.random() * 0.15, size: 3 + Math.random() * 4 };
  });
  if (reduce) return null;
  return (
    <div aria-hidden="true" className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center">
      {particles.map((p) => (
        <div key={p.id} className="absolute rounded-full coin-burst-particle"
          style={{
            width: p.size, height: p.size, background: "#FFD700", boxShadow: "0 0 6px #FFD700, 0 0 12px rgba(255,215,0,0.5)",
            // @ts-expect-error CSS custom properties
            "--burst-x": `${p.dx}px`, "--burst-y": `${p.dy}px`, animationDelay: `${p.delay}s`
          }} />
      ))}
    </div>
  );
}

// ── Confirm Modal (coin purchases) ──
// Accessible dialog: role="dialog" + aria-modal + aria-labelledby, focuses the
// primary control on open, traps Tab within the card, Escape closes, and
// restores focus to the element that opened it on unmount.
function ConfirmModal({ item, quantity, busy, onConfirm, onCancel, userCoins, balanceKnown }: {
  item: ShopItem; quantity: number; busy: boolean; onConfirm: () => void; onCancel: () => void; userCoins: number; balanceKnown: boolean;
}) {
  const totalPrice = item.price * quantity;
  // null = balance still loading (FeaturedCard's "Buy Now" isn't affordance-
  // gated, so this modal CAN open pre-balance) — stay neutral, never claim
  // "Can't Afford" against a phantom 0.
  const canAfford: boolean | null = balanceKnown ? userCoins >= totalPrice : null;
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const reduce = useReducedMotion();

  // Restore focus to the trigger when the dialog unmounts.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    return () => { trigger?.focus?.(); };
  }, []);

  // Focus the primary actionable control on open (the confirm button when it's
  // enabled, otherwise Cancel) so keyboard / SR users land on the action.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (canAfford === true) confirmRef.current?.focus();
      else cancelRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
    // run once on mount — affordance can resolve after open but we don't want
    // to yank focus away mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes; Tab is trapped within the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) { e.preventDefault(); onCancel(); return; }
      if (e.key !== "Tab") return;
      const root = cardRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-labelledby="shop-confirm-title">
      <button
        type="button"
        aria-label="Cancel purchase"
        onClick={() => !busy && onCancel()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
      />
      <div ref={cardRef} className={`shop-card relative w-full max-w-sm rounded-2xl p-6 overflow-hidden ${reduce ? "" : "animate-slide-up"}`}
        style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow }}>
        <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: r.accentLine }} />
        <div className="text-center mb-6">
          <div className="mb-3 flex items-center justify-center">
            <Icon size={52} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
          </div>
          <h3 id="shop-confirm-title" className="font-bebas text-2xl text-cream tracking-wide">{item.name}</h3>
          <span className={`inline-block mt-1 text-[10px] uppercase tracking-widest font-bold px-2.5 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <div className="flex items-center justify-center gap-2 mb-6 py-3 rounded-xl" style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}>
          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
          <span className="font-bebas text-3xl text-gold">{formatCoins(totalPrice)}</span>
          {quantity > 1 && <span className="text-cream/70 text-sm ml-1">(x{quantity})</span>}
        </div>
        {canAfford === false && (
          <p role="alert" className="text-red-400 text-xs text-center mb-4 font-semibold">
            Not enough Fangs. You need {formatCoins(totalPrice - userCoins)} more.
          </p>
        )}
        <div className="flex gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}
            className="flex-1 min-h-[44px] py-3 rounded-xl border border-electric/30 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy">
            Cancel
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm} disabled={canAfford !== true || busy}
            aria-label={canAfford === false ? `Not enough Fangs for ${item.name}` : `Confirm purchase of ${item.name} for ${formatCoins(totalPrice)} Fangs`}
            className={`flex-1 min-h-[44px] py-3 rounded-xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === true ? "gold-btn shop-btn-pulse cursor-pointer focus-visible:ring-gold" : canAfford === false ? "bg-gray-600/30 text-gray-400 cursor-not-allowed border border-gray-600/20 focus-visible:ring-cream/50" : "bg-white/5 text-cream/55 border border-white/10 cursor-wait focus-visible:ring-cream/50"}`}>
            {busy ? "Working..." : canAfford === false ? "Can't Afford" : "Confirm Purchase"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Featured Card ──
// FeaturedCard — same equip / unequip affordance as CosmeticCard so Featured
// behaves identically when an owned item is surfaced there (e.g. Golden Lion Frame).
function FeaturedCard({ item, owned, equipped = false, onBuy, onEquip }: { item: ShopItem; owned: boolean; equipped?: boolean; onBuy: () => void; onEquip?: () => void }) {
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  const isCosmetic = item.type !== "booster";
  return (
    <div className={`fluid-card-hover shop-card shop-tilt-card relative group rounded-2xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden shop-item-float h-full flex flex-col`}
      style={{
        background: r.cardBg,
        border: equipped ? "1.5px solid rgba(34,197,94,0.55)" : `1.5px solid ${r.cardBorder}`,
        boxShadow: r.cardShadow,
        backdropFilter: "blur(20px)",
      }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: equipped ? "rgba(34,197,94,0.85)" : r.accentLine }} />
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative z-[2] p-6 sm:p-8 flex flex-col flex-1">
        <div className="absolute top-4 right-4 flex items-center gap-1.5">
          {equipped && (
            <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">Equipped</span>
          )}
          <span className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <div className="mb-4 shop-item-icon">
          <Icon size={72} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
        </div>
        <h3 className="shop-card-title font-bebas text-2xl sm:text-3xl text-cream tracking-wide mb-1">{item.name}</h3>
        <p className="shop-card-desc text-cream/60 text-sm mb-5 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-6 flex-wrap">
          <div className="flex items-center gap-2 flex-shrink-0">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
            <span className="font-bebas text-2xl text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned && isCosmetic && onEquip ? (
            <button
              type="button"
              onClick={onEquip}
              aria-pressed={equipped}
              aria-label={equipped ? `${item.name} equipped, activate to unequip` : `Equip ${item.name}`}
              className={`flex-shrink-0 min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10 focus-visible:ring-green-400" : "border border-electric/40 text-electric hover:bg-electric/10 focus-visible:ring-electric"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1.5 text-green-400 text-sm font-bold">
              <Check size={16} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button type="button" onClick={onBuy} aria-label={`Buy ${item.name} for ${formatCoins(item.price)} Fangs`} className="gold-btn shop-btn-pulse min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-bold flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy">Buy Now</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Live cosmetic preview (2026-06-11) ──
// Shop cards used to show only a Phosphor icon + the catalog emoji. Cosmetic
// SKUs now render the REAL effect using the SAME renderers the product uses
// (Avatar / AnimatedUsername) + the SAME style maps from cosmetic-styles.ts —
// never a duplicate of the style data. The slot is a FIXED 64px-tall box so
// the card never shifts whether or not a style resolves; if a lookup returns
// null we fall back to the card's existing Phosphor icon (no flash, no gap).
//
// A neutral DiceBear seed is the avatar fallback when the buyer's own avatar
// url isn't handy (logged-out / pre-load). Same DiceBear shape as lib/auth.
const NEUTRAL_PREVIEW_AVATAR =
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Lionade&backgroundColor=4A90D9";

// Resolve the AnimatedUsername effect for a `name_fx_*` SKU id (the page's
// existing id -> effect map). Anything unmapped degrades to "none".
function effectForId(id: string): UsernameEffect {
  return USERNAME_EFFECT_MAP[id] ?? "none";
}

// Fixed-height visual slot. Returns `null` (so the caller falls back to the
// Phosphor icon) for any type without a renderer or any id whose style lookup
// is null — keeping the no-flash / no-layout-shift contract.
function CosmeticPreview({
  item, avatarUrl, username,
}: {
  item: ShopItem;
  avatarUrl: string;
  username: string;
}): JSX.Element | null {
  // Shared fixed slot wrapper so EVERY preview type occupies the same box.
  const wrap = (children: React.ReactNode) => (
    <div className="h-16 flex items-center justify-center" aria-hidden="true">
      {children}
    </div>
  );

  switch (item.type) {
    case "frame":
      // Only render if the id actually resolves a frame style; else fall back.
      if (!getFrameStyle(item.id)) return null;
      return wrap(<Avatar url={avatarUrl} alt="" size="md" frame={item.id} />);
    case "avatar_aura":
      if (!getAuraStyle(item.id)) return null;
      return wrap(<Avatar url={avatarUrl} alt="" size="md" aura={item.id} />);
    case "name_color":
      if (!getNameColorStyle(item.id)) return null;
      return wrap(
        <AnimatedUsername
          username={username}
          nameColor={item.id}
          size="lg"
          className="font-bebas text-2xl tracking-wider"
        />,
      );
    case "username_effect": {
      const effect = effectForId(item.id);
      if (effect === "none") return null;
      return wrap(
        <AnimatedUsername
          username={username}
          effect={effect}
          size="lg"
          className="font-bebas text-2xl tracking-wider"
        />,
      );
    }
    case "banner":
    case "animated_banner": {
      // Compact banner swatch. Distinguish a REAL equipped style from the
      // ambient default by checking the lookup map directly (getBannerStyle
      // would return the default for an unknown id, masking the fallback).
      const banner = BANNER_STYLES[item.id];
      if (!banner) return null;
      return wrap(
        <div
          className={`w-28 h-12 rounded-lg border border-white/5 overflow-hidden ${banner.animClass ?? ""}`}
          style={{ background: banner.background, backgroundSize: banner.backgroundSize }}
        />,
      );
    }
    // voice_skin / booster / anything else → no preview (keep the icon).
    default:
      return null;
  }
}

// ── Cosmetic Card ──
// Bucket C 2026-06-05: equipped frames / name colors / banners now expose an
// inline "Unequip" CTA next to the green Equipped pill so users can clear the
// slot without going to Inventory. Owned-but-not-equipped state gets a quiet
// "Equip" CTA so the shop also doubles as a quick re-equip surface. Callers
// pass `equipped` + `onEquip` from the same handleEquip path that the
// Inventory tab uses, so behavior is consistent across surfaces.
// `canAfford: null` = balance still loading → neutral disabled "Buy" (no
// "Can't Afford" lie, no red/gray affordance) until the balance is known.
function CosmeticCard({ item, owned, equipped = false, canAfford, onBuy, onEquip, previewAvatarUrl, previewUsername }: { item: ShopItem; owned: boolean; equipped?: boolean; canAfford: boolean | null; onBuy: () => void; onEquip?: () => void; previewAvatarUrl?: string; previewUsername?: string }) {
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  // Boosters are equipped-by-use, not by toggle — never show the equip CTA on them.
  const isCosmetic = item.type !== "booster";
  // LIVE cosmetic preview — real effect via the product's own renderers. Null
  // for any type/id without a renderable style → fall back to the Phosphor icon.
  // Called as a plain function so we can branch on the null return.
  const preview = CosmeticPreview({
    item,
    avatarUrl: previewAvatarUrl || NEUTRAL_PREVIEW_AVATAR,
    username: previewUsername || "YourName",
  });
  return (
    <div className={`fluid-card-hover shop-card shop-tilt-card relative group rounded-xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden transition-all duration-300 h-full flex flex-col`}
      style={{
        background: r.cardBg,
        border: equipped ? "1.5px solid rgba(34,197,94,0.55)" : `1.5px solid ${r.cardBorder}`,
        boxShadow: r.cardShadow,
        backdropFilter: "blur(12px)",
      }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: equipped ? "rgba(34,197,94,0.85)" : r.accentLine }} />
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative z-[2] p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-3">
          {/* LIVE preview when the cosmetic resolves a renderable style; else
              the existing Phosphor icon. Both occupy the same vertical slot so
              there is no layout shift between previewable + fallback cards. */}
          <div className="shop-item-icon">
            {preview ?? (item.previewImg ? (
              <div className="h-16 flex items-center">
                <img src={item.previewImg} alt="" aria-hidden="true" className="h-16 w-16 object-contain" />
              </div>
            ) : (
              <div className="h-16 flex items-center">
                <Icon size={40} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {item.comingSoon && (
              <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-white/5 text-cream/60 border border-white/10">Soon</span>
            )}
            {equipped && (
              <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">Equipped</span>
            )}
            <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
          </div>
        </div>
        <h4 className="shop-card-title font-bebas text-lg text-cream tracking-wide mb-0.5">{item.name}</h4>
        <p className="shop-card-desc text-cream/55 text-xs mb-4 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {item.comingSoon ? (
              <span className="font-bebas text-lg text-cream/60 tracking-wide">Soon</span>
            ) : (
              <>
                <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
              </>
            )}
          </div>
          {item.comingSoon ? (
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`${item.name} is coming soon`}
              className="flex-shrink-0 min-h-[44px] px-3.5 py-2.5 rounded-lg text-xs font-bold bg-white/5 text-cream/55 border border-white/10 cursor-not-allowed"
            >
              Coming Soon
            </button>
          ) : owned && isCosmetic && onEquip ? (
            <button
              type="button"
              onClick={onEquip}
              aria-pressed={equipped}
              aria-label={equipped ? `${item.name} equipped, activate to unequip` : `Equip ${item.name}`}
              className={`flex-shrink-0 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10 focus-visible:ring-green-400" : "border border-electric/40 text-electric hover:bg-electric/10 focus-visible:ring-electric"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
              <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button type="button" onClick={onBuy} disabled={canAfford !== true}
              aria-label={canAfford === false ? `Not enough Fangs for ${item.name}` : `Buy ${item.name} for ${formatCoins(item.price)} Fangs`}
              className={`flex-shrink-0 min-h-[44px] px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === true ? "gold-btn shop-btn-pulse focus-visible:ring-gold" : canAfford === false ? "bg-gray-600/20 text-gray-400 cursor-not-allowed border border-gray-600/20 focus-visible:ring-cream/50" : "bg-white/5 text-cream/55 border border-white/10 cursor-wait focus-visible:ring-cream/50"}`}>
              {canAfford === false ? "Can't Afford" : "Buy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Booster Card ──
// `canAfford: null` = balance loading → neutral disabled buy (label keeps the price, no "Can't Afford" lie).
function BoosterCard({ item, quantityOwned, canAfford, onBuy }: { item: ShopItem; quantityOwned: number; canAfford: boolean | null; onBuy: (qty: number) => void }) {
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  const bulkPrice = Math.floor(item.price * 5 * 0.9);
  return (
    <div className={`fluid-card-hover shop-card shop-tilt-card relative group rounded-xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden transition-all duration-300`}
      style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow, backdropFilter: "blur(12px)" }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: r.accentLine }} />
      <div className="relative z-[2] p-4 flex items-center gap-4">
        <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center"
          style={{ background: r.cardBg, border: `1px solid ${r.cardBorder}` }}>
          <Icon size={32} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className="shop-card-title font-bebas text-lg text-cream tracking-wide">{item.name}</h4>
            <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
          </div>
          <p className="shop-card-desc text-cream/55 text-xs mb-3 leading-relaxed">{item.description}</p>
          {item.comingSoon ? (
            // Server blocks this booster with "This item is coming soon" — show a
            // locked affordance instead of a buy button that errors out.
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`${item.name} is coming soon`}
              className="flex items-center gap-1.5 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold bg-white/5 text-cream/55 border border-white/10 cursor-not-allowed"
            >
              Coming Soon
            </button>
          ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => onBuy(1)} disabled={canAfford !== true}
              aria-label={canAfford === false ? `Not enough Fangs for ${item.name}` : `Buy one ${item.name} for ${formatCoins(item.price)} Fangs`}
              className={`flex items-center gap-1.5 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === true ? "gold-btn shop-btn-pulse focus-visible:ring-gold" : canAfford === false ? "bg-gray-600/20 text-gray-400 cursor-not-allowed border border-gray-600/20 focus-visible:ring-cream/50" : "bg-white/5 text-cream/55 border border-white/10 cursor-wait focus-visible:ring-cream/50"}`}>
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(item.price)} &middot; Buy x1
            </button>
            <button type="button" onClick={() => onBuy(5)} disabled={canAfford === false}
              aria-label={`Buy five ${item.name} for ${formatCoins(bulkPrice)} Fangs, save 10 percent`}
              className={`flex items-center gap-1.5 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === false ? "border border-gray-600/20 text-gray-400 cursor-not-allowed" : "border border-electric/40 text-electric hover:bg-electric/10"}`}>
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(bulkPrice)} &middot; Buy x5 <span className={`text-[10px] ${canAfford === false ? "text-gray-400" : "text-green-400"}`}>(save 10%)</span>
            </button>
          </div>
          )}
        </div>
        {quantityOwned > 0 && (
          <div className="absolute top-3 right-3 flex items-center gap-1 bg-electric/10 border border-electric/20 rounded-full px-2.5 py-0.5">
            <span className="text-electric text-xs font-bold">x{quantityOwned}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inventory Item ──
function InventoryItem({ item, owned, onEquip }: { item: ShopItem; owned: OwnedItem; onEquip: () => void }) {
  const r = RARITY_COLORS[item.rarity];
  const isBooster = item.type === "booster";
  const Icon = item.Icon;
  return (
    <div className={`shop-card relative rounded-xl overflow-hidden p-4 transition-all duration-300 ${item.rarity === "legendary" ? "shop-tier-sweep-legendary" : ""}`}
      style={{ background: r.cardBg, border: owned.equipped ? "1.5px solid rgba(34,197,94,0.55)" : `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: owned.equipped ? "rgba(34,197,94,0.85)" : r.accentLine }} />
      {owned.equipped && (
        <div className="absolute top-2 right-2 z-[2] flex items-center gap-1 bg-green-500/20 border border-green-500/30 rounded-full px-2 py-0.5">
          <span className="text-green-400 text-[10px] font-bold uppercase tracking-wider">Equipped</span>
        </div>
      )}
      <div className="relative z-[2] flex items-center gap-3">
        <div className="flex-shrink-0">
          <Icon size={32} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-bebas text-base text-cream tracking-wide">{item.name}</h4>
            <span className={`text-[8px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
          </div>
          {isBooster ? (
            <p className="text-cream/55 text-xs">Qty: {owned.quantity} remaining &middot; Use Before Quiz</p>
          ) : (
            <p className="text-cream/55 text-xs">{item.description}</p>
          )}
        </div>
        {!isBooster && (
          <button type="button" onClick={onEquip}
            aria-pressed={owned.equipped}
            aria-label={owned.equipped ? `${item.name} equipped, activate to unequip` : `Equip ${item.name}`}
            className={`flex-shrink-0 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${owned.equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10 focus-visible:ring-green-400" : "border border-electric/40 text-electric hover:bg-electric/10 focus-visible:ring-electric"}`}>
            {owned.equipped ? "Unequip" : "Equip"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Premium Card ──
function PremiumCard({ item }: { item: PremiumItem }) {
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  return (
    <div className={`fluid-card-hover shop-card shop-tilt-card premium-card relative group rounded-xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden transition-all duration-300 h-full flex flex-col`}
      style={{
        background: r.cardBg.replace(
          "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))",
          "linear-gradient(135deg, rgba(20,8,40,0.9), rgba(10,6,30,0.95))"
        ),
        border: `1.5px solid ${r.cardBorder}`,
        boxShadow: r.cardShadow,
        backdropFilter: "blur(12px)",
      }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: r.accentLine }} />
      {item.rarity === "legendary" && <div className="shop-legendary-border-premium" />}
      {item.rarity === "epic" && <div className="shop-epic-border-premium" />}
      <div className="relative z-[2] p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-3">
          <div className="shop-item-icon premium-icon-glow">
            <Icon size={52} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
          </div>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <h4 className="shop-card-title font-bebas text-xl text-cream tracking-wide mb-0.5">{item.name}</h4>
        <p className="shop-card-desc text-cream/55 text-xs mb-5 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-4">
          <span className="font-bebas text-xl text-purple-300">${item.priceUSD.toFixed(2)}</span>
          {/* Disabled Notify-me state — was a dead "Coming Soon" pill that did
              nothing. Now reads as a real future affordance; click is a no-op
              for now (the waitlist endpoint exists but isn't wired here yet —
              telling Sam to wire it before we make the click work, otherwise
              the button would silently lie). */}
          <button type="button" disabled aria-disabled="true" aria-label={`Notify me when ${item.name} launches`} className="relative flex-shrink-0 min-h-[44px] px-4 py-2.5 rounded-lg text-xs font-bold border border-purple-500/30 bg-purple-500/8 text-purple-200/80 cursor-not-allowed">
            Notify me
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════
// ── Shop V2 cards (2026-06-03) ──
// ══════════════════════════════════════════════════

// Animated username effect card with LIVE PREVIEW of the effect rendered on
// the user's ACTUAL username (high-impact try-before-you-buy).
function UsernameEffectCard({
  item, ownUsername, owned, equipped = false, canAfford, onBuy, onEquip,
}: {
  item: UsernameEffectSKU;
  ownUsername: string;
  owned: boolean;
  equipped?: boolean;
  canAfford: boolean | null;
  onBuy: () => void;
  onEquip?: () => void;
}) {
  const r = RARITY_COLORS[item.rarity];
  // Username effects are always cosmetic (the SKU type is "username_effect").
  const isCosmetic = true;
  return (
    <div className={`fluid-card-hover shop-card relative rounded-xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden h-full flex flex-col`}
      style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow, backdropFilter: "blur(12px)" }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: r.accentLine }} />
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative z-[2] p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-3">
          <span className="text-[10px] uppercase tracking-widest font-bold text-cream/50">Username effect</span>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        {/* LIVE preview tile — your actual username, animated. */}
        <div className="rounded-lg px-3 py-4 mb-3 text-center border border-white/5"
          style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))" }}>
          <AnimatedUsername
            username={ownUsername}
            effect={item.effect}
            size="lg"
            className="font-bebas text-2xl tracking-wider"
          />
        </div>
        <h4 className="font-bebas text-base text-cream tracking-wide mb-0.5">{item.name}</h4>
        <p className="text-cream/55 text-[11px] mb-3 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-3">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned && isCosmetic && onEquip ? (
            <button
              type="button"
              onClick={onEquip}
              aria-pressed={equipped}
              aria-label={equipped ? `${item.name} equipped, activate to unequip` : `Equip ${item.name}`}
              className={`flex-shrink-0 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10 focus-visible:ring-green-400" : "border border-electric/40 text-electric hover:bg-electric/10 focus-visible:ring-electric"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
              <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button type="button" onClick={onBuy} disabled={canAfford !== true}
              aria-label={canAfford === false ? `Not enough Fangs for ${item.name}` : `Buy ${item.name} for ${formatCoins(item.price)} Fangs`}
              className={`flex-shrink-0 min-h-[44px] px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === true ? "gold-btn shop-btn-pulse focus-visible:ring-gold" : canAfford === false ? "bg-gray-600/20 text-gray-400 cursor-not-allowed border border-gray-600/20 focus-visible:ring-cream/50" : "bg-white/5 text-cream/55 border border-white/10 cursor-wait focus-visible:ring-cream/50"}`}>
              {canAfford === false ? "Can't Afford" : "Buy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Premium Fang banner card — small looping preview tile.
function PremiumFangBannerCard({ item, owned, equipped = false, canAfford, onBuy, onEquip }: { item: ShopItem; owned: boolean; equipped?: boolean; canAfford: boolean | null; onBuy: () => void; onEquip?: () => void }) {
  const r = RARITY_COLORS[item.rarity];
  // animated_banner is a cosmetic — equip CTA always available when owned.
  const isCosmetic = item.type !== "booster";
  const Icon = item.Icon;
  const reduce = useReducedMotion();
  return (
    <div className={`fluid-card-hover shop-card relative rounded-xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden h-full flex flex-col`}
      style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow, backdropFilter: "blur(12px)" }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: r.accentLine }} />
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative z-[2] p-4 flex flex-col flex-1">
        {/* Looping preview tile (gradient swatch + icon). Inline animation is
            gated on reduced-motion (it bypasses the global CSS guard). */}
        <div aria-hidden="true" className="h-16 rounded-lg mb-3 relative overflow-hidden border border-white/5"
          style={{
            background: item.rarity === "legendary"
              ? "linear-gradient(120deg, rgba(255,215,0,0.25), rgba(168,85,247,0.15), rgba(74,144,217,0.25))"
              : item.rarity === "epic"
              ? "linear-gradient(120deg, rgba(168,85,247,0.20), rgba(74,144,217,0.15))"
              : "linear-gradient(120deg, rgba(74,144,217,0.15), rgba(34,197,94,0.10))",
            backgroundSize: "200% 100%",
            animation: reduce ? undefined : "au-name-rainbow 6s linear infinite",
          }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon size={28} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
          </div>
        </div>
        <div className="flex items-start justify-between mb-1">
          <h4 className="font-bebas text-base text-cream tracking-wide">{item.name}</h4>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <p className="text-cream/55 text-[11px] mb-3 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-3">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned && isCosmetic && onEquip ? (
            <button
              type="button"
              onClick={onEquip}
              aria-pressed={equipped}
              aria-label={equipped ? `${item.name} equipped, activate to unequip` : `Equip ${item.name}`}
              className={`flex-shrink-0 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10 focus-visible:ring-green-400" : "border border-electric/40 text-electric hover:bg-electric/10 focus-visible:ring-electric"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
              <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button type="button" onClick={onBuy} disabled={canAfford !== true}
              aria-label={canAfford === false ? `Not enough Fangs for ${item.name}` : `Buy ${item.name} for ${formatCoins(item.price)} Fangs`}
              className={`flex-shrink-0 min-h-[44px] px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === true ? "gold-btn shop-btn-pulse focus-visible:ring-gold" : canAfford === false ? "bg-gray-600/20 text-gray-400 cursor-not-allowed border border-gray-600/20 focus-visible:ring-cream/50" : "bg-white/5 text-cream/55 border border-white/10 cursor-wait focus-visible:ring-cream/50"}`}>
              {canAfford === false ? "Can't Afford" : "Buy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Founder badge card. Founder badges are NEVER sold for Fangs, so the footer
// is a STATUS, not a Buy: Founding Scholar shows a "Get with Pro" CTA; the
// auto-granted badges show how they're earned. Owned always wins.
function FounderBadgeCard({
  item, remaining, owned,
}: {
  item: FounderBadgeSKU;
  remaining: number | null;
  owned: boolean;
}) {
  const Icon = item.Icon;
  // "Closed" = a capped badge whose remaining hit 0, for a viewer who doesn't
  // own it. Owned takes precedence (never overlay "claimed" on your own badge).
  const closed = !owned && item.showCap && remaining !== null && remaining <= 0;
  return (
    <div className="fluid-card-hover shop-card shop-legendary-sparkle relative rounded-2xl overflow-hidden h-full flex flex-col"
      style={{
        background: "linear-gradient(135deg, rgba(40,28,8,0.95), rgba(8,6,16,0.95))",
        border: `1px solid ${closed ? "rgba(156,163,175,0.20)" : "rgba(255,215,0,0.35)"}`,
        backdropFilter: "blur(16px)",
      }}>
      {closed && (
        <div className="absolute inset-0 z-10 bg-black/55 backdrop-blur-sm flex flex-col items-center justify-center">
          <Lock size={32} weight="fill" color="#9CA3AF" aria-hidden="true" />
          <p className="font-bebas text-xl text-cream/80 tracking-wider mt-2">CLAIMED</p>
          <p className="text-cream/60 text-[10px] font-mono uppercase tracking-[0.22em] mt-0.5">All {item.cap.toLocaleString()} taken</p>
        </div>
      )}
      <div className="relative p-5 flex flex-col flex-1">
        <span className="absolute top-3 right-3 text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-gold/20 text-gold border border-gold/30">
          Founder
        </span>
        <div className="mb-3 flex items-center justify-center h-16">
          <Icon size={52} weight="fill" color={item.iconColor} aria-hidden="true" />
        </div>
        <h4 className="font-bebas text-xl text-cream tracking-wide text-center">{item.name}</h4>
        <p className="text-cream/55 text-xs text-center mb-3 leading-relaxed">{item.tagline}</p>

        {/* FOMO counter — only for capped badges. `247 of 1,000 remaining`. */}
        {item.showCap && (
          <div className="text-center mb-4 py-2 rounded-lg" style={{ background: "rgba(255,215,0,0.05)", border: "1px solid rgba(255,215,0,0.12)" }}>
            {remaining === null ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60">Cap of {item.cap.toLocaleString()}</p>
            ) : (
              <>
                <p className="font-bebas text-xl text-gold tracking-wider leading-none">{remaining.toLocaleString()}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/60 mt-0.5">
                  of {item.cap.toLocaleString()} remaining
                </p>
              </>
            )}
          </div>
        )}

        {/* Footer: status, never a Fangs buy. */}
        <div className="mt-auto pt-1">
          {owned ? (
            <span className="flex items-center justify-center gap-1.5 text-green-400 text-sm font-bold py-2.5 rounded-lg bg-green-500/10 border border-green-500/25">
              <Check size={15} weight="bold" color="#22C55E" aria-hidden="true" /> Yours
            </span>
          ) : item.acquire === "pro" ? (
            <a
              href="/pricing"
              aria-label={`Get ${item.name} with Lionade Pro`}
              className="gold-btn shop-btn-pulse flex items-center justify-center gap-1.5 min-h-[44px] py-2.5 rounded-lg text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            >
              <Crown size={15} weight="fill" aria-hidden="true" /> Get with Pro
            </a>
          ) : (
            <span className="flex items-center justify-center text-center gap-1.5 text-cream/55 text-[11px] font-mono uppercase tracking-[0.14em] py-2.5 px-2 rounded-lg bg-white/5 border border-white/10 leading-tight">
              {item.acquireNote}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════
// ── Buy Fangs section (Stripe IAP) ──
// ══════════════════════════════════════════════════
function BuyFangsSection({ isAuthed, onUnauthed }: { isAuthed: boolean; onUnauthed: () => void }) {
  const [pending, setPending] = useState<FangPackId | null>(null);

  async function handleBuyPack(pack: FangPack) {
    if (pending) return;
    if (!isAuthed) {
      onUnauthed();
      return;
    }
    setPending(pack.id);
    try {
      const res = await apiPost<{ url: string }>("/api/stripe/fang-purchase", { packId: pack.id });
      if (!res.ok || !res.data?.url) {
        if (res.status === 401) {
          onUnauthed();
          setPending(null);
          return;
        }
        console.error("[shop:fang-checkout] failed", res.error);
        toastError("Couldn't open checkout. Try again.");
        setPending(null);
        return;
      }
      window.location.href = res.data.url;
    } catch (e) {
      console.error("[shop:fang-checkout] threw", e);
      toastError("Couldn't open checkout. Try again.");
      setPending(null);
    }
  }

  return (
    <section className="mb-10" aria-labelledby="buy-fangs-heading">
      <div className="shop-banner flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
        style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.08), rgba(74,144,217,0.06))", border: "1px solid rgba(255,215,0,0.20)" }}>
        <div className="flex items-center gap-2">
          <img src={cdnUrl("/F.png")} alt="" aria-hidden="true" className="w-5 h-5 object-contain" />
          <h2 id="buy-fangs-heading" className="font-bebas text-xl text-gold tracking-wider">BUY FANGS</h2>
        </div>
        <p className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
          Top up. Spend on cosmetics, boosters, anything in the den.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {FANG_IAP_PACKS.map((pack) => {
          const isPending = pending === pack.id;
          const disabled = pending !== null && !isPending;
          const isValue = pack.accent === "value";
          const isMega = pack.accent === "mega";
          const cardStyle = isMega
            ? { background: "linear-gradient(135deg, rgba(40,12,70,0.95), rgba(10,6,30,0.95))", border: "1px solid rgba(168,85,247,0.35)" }
            : isValue
              ? { background: "linear-gradient(135deg, rgba(20,16,8,0.95), rgba(8,12,24,0.95))", border: "1px solid rgba(255,215,0,0.30)" }
              : { background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))", border: "1px solid rgba(255,255,255,0.10)" };
          return (
            <div key={pack.id}
              className="fluid-card-hover shop-card relative rounded-2xl overflow-hidden backdrop-blur-xl flex flex-col p-5"
              style={cardStyle}>
              {pack.badge && (
                <span className={`absolute top-3 right-3 text-[9px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full ${
                  pack.badge.tone === "best"
                    ? "bg-gold/20 text-gold border border-gold/30"
                    : "bg-purple-500/25 text-purple-200 border border-purple-400/40"
                }`}>
                  {pack.badge.label}
                </span>
              )}

              <div className="flex items-center gap-3 mb-3">
                <img src={cdnUrl("/F.png")} alt="Fangs" className={`object-contain ${isMega || isValue ? "w-14 h-14" : "w-12 h-12"}`} />
                <div>
                  <p className="font-bebas text-2xl text-cream tracking-wide leading-none">{pack.name}</p>
                  <p className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.18em] mt-1">{pack.bonusLabel}</p>
                </div>
              </div>

              <div className="mt-1 mb-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-bebas text-4xl text-gold tracking-wider leading-none">{formatCoins(pack.fangs)}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">Fangs</span>
                </div>
                {pack.bonus > 0 && (
                  <p className="text-[11px] text-cream/55 mt-1">
                    Base 5,000 + <span className="text-gold/80 font-bold">{formatCoins(pack.bonus)}</span> bonus
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleBuyPack(pack)}
                disabled={disabled || isPending}
                aria-label={`Buy ${pack.name}: ${formatCoins(pack.fangs)} Fangs for $${pack.priceUSD.toFixed(2)}`}
                aria-busy={isPending}
                className={`mt-auto inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl py-2.5 px-4 text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
                  disabled
                    ? "bg-white/[0.06] text-cream/55 border border-white/[0.08] cursor-not-allowed"
                    : "gold-btn shop-btn-pulse"
                } ${isPending ? "opacity-80 cursor-wait" : ""}`}
              >
                {isPending ? (
                  <>
                    <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />
                    Opening checkout
                  </>
                ) : (
                  <>${pack.priceUSD.toFixed(2)} &middot; Buy now</>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/55 mt-4">
        Secure checkout via Stripe &middot; USD &middot; Fangs land instantly
      </p>
    </section>
  );
}

// ══════════════════════════════════════════════════
// ── Main Shop Page ──
// ══════════════════════════════════════════════════
export default function ShopPage() {
  const { user, isLoading, refreshUser } = useAuth();
  const { stats } = useUserStats(user?.id);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [storeMode, setStoreMode] = useState<StoreMode>("coins");
  const [tab, setTab] = useState<Tab>("featured");
  const [premiumTab, setPremiumTab] = useState<PremiumTab>("themes");
  const [cosmeticSub, setCosmeticSub] = useState<CosmeticSub>("frames");
  const [confirmItem, setConfirmItem] = useState<{ item: ShopItem; quantity: number } | null>(null);
  const [showBurst, setShowBurst] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Polite live-region message announced to AT on async purchase / equip
  // outcomes (visual toasts aren't surfaced to screen readers here).
  const [announce, setAnnounce] = useState("");

  useEffect(() => { setMounted(true); }, []);

  // Stripe Checkout canceled return state — Stripe redirects to
  // /shop?iap=canceled when the user closes the Checkout tab without paying.
  // Mirror the pricing page pattern: polite toast, then strip the query param
  // so a back/forward nav doesn't re-fire.
  useEffect(() => {
    if (searchParams?.get("iap") !== "canceled") return;
    toastInfo("Purchase canceled. Try again anytime.");
    router.replace("/shop");
  }, [searchParams, router]);

  // 2026-05-25 (Phase A perf): inventory was a raw useEffect → setState fetch
  // that re-fired on every shop mount (incl. tab-switch back). Moved into the
  // global SWR cache with 60s dedupe so tab-switches are instant. Equip /
  // purchase still feels immediate via the imperative `mutate()` calls below
  // (revalidates from server truth after the mutation API resolves).
  const inventoryKey = user?.id ? `shop-inventory/${user.id}` : null;
  const { data: inventoryData, mutate: mutateInventory } = useSWR(
    inventoryKey,
    () => apiGet<{ inventory: OwnedItem[] }>("/api/shop/purchase"),
    { dedupingInterval: 60_000, keepPreviousData: true },
  );
  const inventory: OwnedItem[] = inventoryData?.ok ? (inventoryData.data?.inventory ?? []) : [];
  // Flash-of-ownership gate: SWR `data` is `undefined` until the first inventory
  // fetch resolves. Treating that as "owns nothing" would briefly render a
  // clickable "Buy" on items the user actually owns, then flip to "Owned".
  // For a signed-in user we hold the buy affordances neutral until the
  // inventory has resolved at least once. Logged-out visitors never fetch
  // (key is null) so we treat them as "known" to avoid a permanent loading state.
  const inventoryKnown = !user?.id || inventoryData !== undefined;

  // Shop V2 — earned + founder cosmetics ride on a separate endpoint with
  // `source` attribution (purchased / founder / earned). Inventory tab unions
  // both lists so all owned cosmetics are visible in one place.
  const cosmeticsOwnedKey = user?.id ? `cosmetics-owned/${user.id}` : null;
  const { data: cosmeticsOwnedData, mutate: mutateCosmeticsOwned } = useSWR(
    cosmeticsOwnedKey,
    // The route returns TWO arrays: `cosmetics` carries id/type/source, `items`
    // carries the equipped flag (keyed by itemId). Merge them so each owned row
    // has id+type+source+equipped. Reading `items` alone (its keys are
    // itemId/itemType, NOT id/type) silently broke every owned-state check and
    // crashed the inventory render on `c.type.replace(...)`.
    () => apiGet<{
      items: { itemId: string; itemType: string | null; equipped?: boolean; acquiredAt: string | null }[];
      cosmetics: { id: string; type: string | null; source: "purchased" | "founder" | "earned"; acquiredAt: string | null }[];
    }>("/api/cosmetics/owned"),
    { dedupingInterval: 60_000, keepPreviousData: true, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const cosmeticsOwnedRaw = cosmeticsOwnedData?.ok ? cosmeticsOwnedData.data : null;
  const cosmeticsEquippedById = new Map(
    (cosmeticsOwnedRaw?.items ?? []).map((i) => [i.itemId, i.equipped ?? false] as const),
  );
  const cosmeticsOwned = (cosmeticsOwnedRaw?.cosmetics ?? []).map((c) => ({
    id: c.id,
    type: c.type,
    source: c.source,
    equipped: cosmeticsEquippedById.get(c.id) ?? false,
  }));

  // Shop V2 — founder badge cap counts. Endpoint returns remaining per id.
  // Defaults to `null` (count unknown / cap closed unclear) if not yet shipped.
  const founderCapsKey = user?.id ? `founder-caps/${user.id}` : null;
  const { data: founderCapsData } = useSWR(
    founderCapsKey,
    () => apiGet<{ caps: Record<string, { granted: number; cap: number }> }>("/api/shop/founder-caps"),
    { dedupingInterval: 30_000, keepPreviousData: true, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  // Endpoint returns `{ badge_id: { granted, cap } }`. remaining = cap - granted,
  // clamped at 0; null when the count is unknown (endpoint down / id absent).
  const founderCaps: Record<string, { granted: number; cap: number }> = founderCapsData?.ok ? (founderCapsData.data?.caps ?? {}) : {};
  const founderRemaining = (id: string): number | null => {
    const c = founderCaps[id];
    return c ? Math.max(0, c.cap - c.granted) : null;
  };

  // Page-level reduced-motion preference. Declared before any early return so
  // the hook order stays stable. Gates the one-shot mount entrance transitions.
  const reduce = useReducedMotion();

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <div aria-hidden="true" className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent motion-safe:animate-spin" />
        <p className="font-bebas text-2xl text-electric tracking-widest">LOADING...</p>
      </div>
    </div>
  );

  // LIVE cosmetic previews render against the buyer's OWN avatar + username so
  // frame/aura/name cards show what the item looks like on THEM. Memoized so
  // the DiceBear fallback url is stable across renders (avatar-stability rule).
  const previewAvatarUrl = useMemo(
    () => user?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username ?? "Lionade"}&backgroundColor=4A90D9`,
    [user?.avatar, user?.username],
  );
  const previewUsername = user?.username ?? "YourName";

  const userCoins = stats?.coins ?? user?.coins ?? 0;
  // Flash-of-zero gate (CLAUDE.md non-negotiable): the header balance pill
  // must not render "0" before stats/user resolve. Once either source has
  // delivered a number we lock the display in; downstream affordances
  // (canAfford / Buy disabled) keep using userCoins so the math stays honest.
  const balanceKnown = typeof stats?.coins === "number" || typeof user?.coins === "number";
  // Tri-state affordance: `null` while the balance is still loading so Buy
  // buttons render a neutral disabled state instead of lying with
  // "Can't Afford" against a phantom 0 balance. Once known, the boolean math
  // is untouched. Logged-out visitors (isLoading already early-returned, so
  // !user means truly signed out) genuinely have 0 Fangs — their balance is
  // "known", keeping the pre-existing disabled-affordance behavior instead of
  // a forever-loading neutral state.
  // Affordance is "known" once BOTH the balance and the inventory have resolved
  // for a signed-in user (so we never flash a clickable Buy on an owned item or
  // lie about affordability against a phantom 0). Logged-out visitors genuinely
  // have 0 Fangs and no inventory to wait on.
  const affordanceKnown = (balanceKnown && inventoryKnown) || !user;
  const affords = (price: number): boolean | null => (affordanceKnown ? userCoins >= price : null);
  const countdown = getWeeklyCountdown();
  const ownedIds = new Set(inventory.map((i) => i.itemId));
  const getOwned = (id: string) => inventory.find((i) => i.itemId === id);
  const getQuantity = (id: string) => getOwned(id)?.quantity ?? 0;
  // Bucket C 2026-06-05 — equipped lookup for Shop unequip CTA. Returns false
  // for items not in inventory so the shop browse grids can show "Equip" on
  // owned-but-not-equipped items in one branch and "Unequip" on equipped ones.
  const isEquipped = (id: string) => !!getOwned(id)?.equipped;
  const requireLogin = () => { if (!user) { router.push("/login"); return true; } return false; };

  const handlePurchase = async () => {
    if (!confirmItem || purchasing || !user) return;
    const itemName = confirmItem.item.name;
    setPurchasing(true);
    try {
      // Server reads price from the catalog — we only send itemId + quantity
      const res = await apiPost("/api/shop/purchase", {
        itemId: confirmItem.item.id,
        quantity: confirmItem.quantity,
      });
      if (res.ok) {
        setShowBurst(true);
        toastSuccess(`${itemName} added to your inventory.`);
        setAnnounce(`Purchased ${itemName}.`);
        await refreshUser();
        await mutateInventory();
      } else {
        // Surface the failure instead of silently closing the modal.
        console.error("[shop:purchase] failed", res.error);
        toastError("Purchase didn't go through. Try again.");
        setAnnounce("Purchase failed. Try again.");
      }
    } catch (e) {
      console.error("[shop:purchase] threw", e);
      toastError("Purchase didn't go through. Try again.");
      setAnnounce("Purchase failed. Try again.");
    } finally {
      setPurchasing(false);
      setConfirmItem(null);
    }
  };

  const handleEquip = async (itemId: string) => {
    if (!user) return;
    try {
      const res = await apiPost("/api/shop/equip", { itemId });
      if (!res.ok) {
        console.error("[shop:equip] failed", res.error);
        toastError("Couldn't update that item. Try again.");
        return;
      }
      // Revalidate BOTH caches: mutateInventory updates the shop's own
      // owned/equipped pills, and mutateCosmeticsOwned refreshes the
      // self-cosmetic hook (useEquippedCosmetics) so the newly equipped
      // frame/aura/name-color paints immediately on the navbar, dashboard
      // hero and profile without waiting for a focus revalidation.
      await Promise.all([mutateInventory(), mutateCosmeticsOwned()]);
    } catch (e) {
      console.error("[shop:equip] threw", e);
      toastError("Couldn't update that item. Try again.");
    }
  };

  // Roving-tabindex keyboard nav for any ARIA tablist: Left/Right (and Up/Down)
  // move focus + select the adjacent tab, Home/End jump to the ends. Operates on
  // the [role="tab"] children of the activated tab's tablist so one handler
  // serves every tab group on the page without per-list ref arrays.
  const handleTabKeys = (e: React.KeyboardEvent<HTMLButtonElement>, select: (i: number) => void) => {
    const key = e.key;
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
    const list = e.currentTarget.closest('[role="tablist"]');
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = tabs.indexOf(e.currentTarget);
    if (current === -1) return;
    e.preventDefault();
    let next = current;
    if (key === "ArrowRight" || key === "ArrowDown") next = (current + 1) % tabs.length;
    else if (key === "ArrowLeft" || key === "ArrowUp") next = (current - 1 + tabs.length) % tabs.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = tabs.length - 1;
    select(next);
    tabs[next]?.focus();
  };

  const TABS: { key: Tab; label: string; Icon: PhosphorIcon; iconWeight?: IconProps["weight"] }[] = [
    { key: "featured", label: "Featured", Icon: Star, iconWeight: "fill" },
    { key: "cosmetics", label: "Cosmetics", Icon: Sparkle, iconWeight: "fill" },
    { key: "boosters", label: "Boosters", Icon: Rocket, iconWeight: "regular" },
    { key: "inventory", label: "Inventory", Icon: Backpack, iconWeight: "regular" },
  ];

  const COSMETIC_SUBS: { key: CosmeticSub; label: string }[] = [
    { key: "frames", label: "Frames" },
    { key: "name_colors", label: "Name Colors" }, { key: "banners", label: "Banners" },
  ];

  const cosmeticTypeMap: Record<CosmeticSub, ItemType> = { frames: "frame", backgrounds: "background", name_colors: "name_color", banners: "banner" };
  const filteredCosmetics = COSMETIC_ITEMS.filter((i) => i.type === cosmeticTypeMap[cosmeticSub]);

  const ownedCosmetics = inventory.filter((o) => { const item = [...COSMETIC_ITEMS, ...FEATURED_ITEMS, ...NEW_SKUS, ...AVATAR_AURAS, ...USERNAME_EFFECTS, ...PREMIUM_FANG_BANNERS].find((i) => i.id === o.itemId); return item && item.type !== "booster"; });
  const ownedBoosters = inventory.filter((o) => { const item = [...BOOSTER_ITEMS, ...FEATURED_ITEMS, ...NEW_SKUS].find((i) => i.id === o.itemId); return item && item.type === "booster"; });
  const allItems: ShopItem[] = [...COSMETIC_ITEMS, ...BOOSTER_ITEMS, ...FEATURED_ITEMS, ...NEW_SKUS, ...AVATAR_AURAS, ...USERNAME_EFFECTS, ...PREMIUM_FANG_BANNERS];
  const findItem = (id: string) => allItems.find((i) => i.id === id);
  // Human label for an owned cosmetic id (Identity & Status rows). Tries the
  // catalog + founder set, then falls back to a Title-Cased id so a row never
  // renders a raw snake_case identifier.
  const displayNameForCosmetic = (id: string): string => {
    const fromCatalog = findItem(id)?.name;
    if (fromCatalog) return fromCatalog;
    const founder = FOUNDER_BADGES.find((b) => b.id === id)?.name;
    if (founder) return founder;
    return id.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  };
  // Drops + Trending render a plain Buy button with no coming-soon gate, so
  // exclude server-blocked items from those pools (voice_ninny_classic +
  // boost_mastery_hint_pack). allItems itself stays complete for inventory.
  const purchasablePool: ShopItem[] = allItems.filter((i) => !i.comingSoon);

  // ── Today's Drops (deterministic-by-UTC-date, rotates daily) ──
  // Pool = every Fang-priced SKU on the page. The helper filters out founder
  // badges + earned cosmetics. useMemo keyed by UTC-date string so the drops
  // recompute exactly once per date boundary (the date crossing happens on
  // the next render after midnight UTC anyway, but this keeps it cheap).
  const utcDateKey = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todaysDrops = useMemo<ShopItem[]>(() => {
    // The helper signature uses the core ShopItem; the local extended
    // ShopItem is a structural superset (adds Icon/iconColor/etc.), so we
    // cast through CoreShopItem for the filter pass and return the matching
    // local objects to preserve Icon/iconColor for rendering.
    const pool = purchasablePool as unknown as CoreShopItem[];
    const picked = pickTodaysDrops(pool, new Date(), 5);
    const pickedIds = new Set(picked.map((p) => p.id));
    return purchasablePool.filter((i) => pickedIds.has(i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utcDateKey]);

  // ── Trending (top 3 by 7-day purchase velocity) ──
  // Public endpoint, dedupe 5 minutes, fall back to a hand-picked 3 from
  // FEATURED_ITEMS when the window has < 3 distinct purchases.
  const { data: trendingData } = useSWR(
    "shop-trending",
    () => apiGet<{ trending: string[] }>("/api/shop/trending"),
    { dedupingInterval: 5 * 60_000, keepPreviousData: true, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const trendingIds: string[] = trendingData?.ok ? (trendingData.data?.trending ?? []) : [];
  const trendingItems: ShopItem[] = useMemo(() => {
    const live = trendingIds
      .map((id) => purchasablePool.find((i) => i.id === id))
      .filter((i): i is ShopItem => !!i);
    if (live.length >= 3) return live.slice(0, 3);
    // Early-days fallback: union live results with a hand-picked set of
    // FEATURED_ITEMS so the section always has exactly 3 cards. De-dup by id.
    const fallback = FEATURED_ITEMS.slice(0, 3);
    const seen = new Set(live.map((l) => l.id));
    for (const f of fallback) {
      if (seen.has(f.id)) continue;
      live.push(f);
      seen.add(f.id);
      if (live.length === 3) break;
    }
    return live.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendingIds.join("|")]);

  // Shop V2 — equip a username effect via PATCH /api/me/equip. Endpoint may
  // not yet be live (backend follow-up flagged in the vault note). Falls back
  // to a polite toast if the route 404s.
  const handleEquipUsernameEffect = async (cosmeticId: string) => {
    if (!user) return;
    const res = await apiPost("/api/me/equip", { slot: "username_effect", cosmetic_id: cosmeticId });
    if (!res.ok) {
      console.error("[shop:equip-username-effect] failed", res.error);
      toastError("Couldn't equip that yet. Try again shortly.");
      setAnnounce("Couldn't equip that yet.");
      return;
    }
    toastSuccess("Equipped");
    setAnnounce("Equipped.");
    await Promise.all([mutateInventory(), mutateCosmeticsOwned()]);
  };

  const isPremium = storeMode === "premium";

  return (
    <FeatureGate feature="shop">
    <div className={`min-h-screen pt-16 pb-24 md:pb-12 transition-colors duration-500 ${isPremium ? "premium-store-bg" : ""}`}>
      {showBurst && <PurchaseBurst onDone={() => setShowBurst(false)} />}
      {confirmItem && <ConfirmModal item={confirmItem.item} quantity={confirmItem.quantity} busy={purchasing} onConfirm={handlePurchase} onCancel={() => { if (!purchasing) setConfirmItem(null); }} userCoins={userCoins} balanceKnown={affordanceKnown} />}

      {/* Polite live region for async purchase / equip outcomes. */}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ── Header ── */}
        <div className={`relative text-center mb-6 ${reduce ? "" : "transition-all duration-700"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          {/* Gold-particle drift behind the title — sits below content via z-0 */}
          {!isPremium && mounted && <HeroGoldDrift />}
          <div className="relative z-[1] flex items-center justify-center gap-3 mb-2">
            <span className="flex items-center sm:hidden">
              {isPremium
                ? <Diamond size={40} weight="fill" color="#A855F7" aria-hidden="true" />
                : <Bank size={40} weight="regular" color="#FFD700" aria-hidden="true" />}
            </span>
            <span className="hidden sm:flex items-center">
              {isPremium
                ? <Diamond size={52} weight="fill" color="#A855F7" aria-hidden="true" />
                : <Bank size={52} weight="regular" color="#FFD700" aria-hidden="true" />}
            </span>
            <h1 className={`font-bebas text-5xl sm:text-7xl tracking-wider ${isPremium ? "shop-title-glow-premium" : "shop-title-glow"}`}>
              THE LION&apos;S DEN
            </h1>
            <span className="flex items-center sm:hidden">
              {isPremium
                ? <Sparkle size={40} weight="fill" color="#A855F7" aria-hidden="true" />
                : <PawPrint size={40} weight="fill" color="#FFD700" aria-hidden="true" />}
            </span>
            <span className="hidden sm:flex items-center">
              {isPremium
                ? <Sparkle size={52} weight="fill" color="#A855F7" aria-hidden="true" />
                : <PawPrint size={52} weight="fill" color="#FFD700" aria-hidden="true" />}
            </span>
          </div>
          <p className={`relative z-[1] text-sm font-semibold tracking-widest uppercase ${isPremium ? "text-purple-400/60" : "text-cream/60"}`}>
            {isPremium ? "Premium Collection" : "Premium Item Shop"}
          </p>

          {/* Coin balance (coin store) / info (premium) */}
          <div className={`relative z-[1] inline-flex items-center gap-2 mt-4 px-5 py-2 rounded-full transition-all duration-300 ${isPremium
            ? "border border-purple-500/20"
            : ""}`}
            style={isPremium
              ? { background: "rgba(168,85,247,0.08)" }
              : { background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)" }}>
            {isPremium ? (
              <>
                <Diamond size={20} weight="fill" color="#A855F7" aria-hidden="true" />
                <span className="font-bebas text-2xl text-purple-300 tracking-wider">Premium</span>
              </>
            ) : (
              <>
                <img src={cdnUrl("/F.png")} alt="Fangs" className="w-8 h-8 object-contain" />
                {balanceKnown ? (
                  <span className="font-bebas text-3xl text-gold tracking-wider">{formatCoins(userCoins)}</span>
                ) : (
                  <span aria-hidden="true" className="inline-block w-16 h-7 rounded-md shop-balance-skeleton" />
                )}
                <span className="text-cream/55 text-xs ml-1">Fangs</span>
              </>
            )}
          </div>
        </div>

        {/* ── Store Mode Toggle ── */}
        <div className={`flex items-center justify-center mb-8 ${reduce ? "" : "transition-all duration-700 delay-75"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          <div role="tablist" aria-label="Store mode" className="shop-toggle relative flex items-center rounded-full p-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* Sliding indicator */}
            <div aria-hidden="true" className={`absolute top-1 bottom-1 rounded-full ${reduce ? "" : "transition-all duration-300 ease-out"}`}
              style={{
                width: "calc(50% - 4px)",
                left: isPremium ? "calc(50% + 2px)" : "4px",
                background: isPremium
                  ? "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(124,58,237,0.15))"
                  : "linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,165,0,0.1))",
                border: isPremium ? "1px solid rgba(168,85,247,0.3)" : "1px solid rgba(255,215,0,0.25)",
              }} />

            <button type="button" role="tab" id="store-tab-coins" aria-selected={!isPremium} aria-controls="store-panel-coins" tabIndex={!isPremium ? 0 : -1}
              onClick={() => setStoreMode("coins")}
              onKeyDown={(e) => handleTabKeys(e, (i) => setStoreMode(i === 0 ? "coins" : "premium"))}
              className={`relative z-10 flex items-center gap-2 min-h-[44px] px-5 sm:px-7 py-2.5 rounded-full text-sm font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${!isPremium ? "text-gold" : "text-cream/60 hover:text-cream"}`}>
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> Coin Store
            </button>
            <button type="button" role="tab" id="store-tab-premium" aria-selected={isPremium} aria-controls="store-panel-premium" tabIndex={isPremium ? 0 : -1}
              onClick={() => setStoreMode("premium")}
              onKeyDown={(e) => handleTabKeys(e, (i) => setStoreMode(i === 0 ? "coins" : "premium"))}
              className={`relative z-10 flex items-center gap-2 min-h-[44px] px-5 sm:px-7 py-2.5 rounded-full text-sm font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${isPremium ? "text-purple-300" : "text-cream/60 hover:text-cream"}`}>
              <Diamond size={18} weight="fill" color={isPremium ? "#D8B4FE" : "currentColor"} aria-hidden="true" /> Premium Store
            </button>
          </div>
        </div>

        {/* ══════════ BUY FANGS (Stripe IAP, coin store only) ══════════ */}
        {!isPremium && (
          <FeatureGate feature="shop.fang_iap" compact>
            <div className={`${reduce ? "" : "transition-all duration-700 delay-150"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
              <BuyFangsSection
                isAuthed={!!user}
                onUnauthed={() => router.push("/login?next=/shop")}
              />
            </div>
          </FeatureGate>
        )}

        {/* ══════════ DAILY SPIN HERO (coin store only) ══════════ */}
        {!isPremium && (
          <FeatureGate feature="shop.daily_spin" compact>
            <DailySpinHero />
          </FeatureGate>
        )}

        {/* ══════════ TODAY'S DROPS (coin store only, above tabs) ══════════ */}
        {/* Deterministic-by-UTC-date rotation. Same drops for every user
            today; fresh ones tomorrow. Bigger cards (~1.5x) + TODAY tag. */}
        {!isPremium && todaysDrops.length > 0 && (
          <section className="mb-8" aria-labelledby="todays-drops-heading">
            <div className="shop-banner flex items-center justify-between mb-4 px-4 py-3 rounded-xl"
              style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.10), rgba(74,144,217,0.06))", border: "1px solid rgba(255,215,0,0.22)" }}>
              <div className="flex items-center gap-2">
                <Sparkle size={20} weight="fill" color="#FFD700" aria-hidden="true" />
                <h2 id="todays-drops-heading" className="font-bebas text-xl text-gold tracking-wider">TODAY&apos;S DROPS</h2>
              </div>
              <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                Fresh picks &middot; new set tomorrow
              </span>
            </div>
            {/* Horizontal scroll on mobile, grid on desktop. */}
            <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 overflow-x-auto sm:overflow-visible pb-3 sm:pb-0 scrollbar-hide shop-grid-stagger">
              {todaysDrops.map((item) => {
                const r = RARITY_COLORS[item.rarity];
                const Icon = item.Icon;
                const owned = ownedIds.has(item.id);
                const canAfford = affords(item.price);
                return (
                  <div key={item.id}
                    className={`fluid-card-hover shop-card relative group rounded-2xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden flex-shrink-0 w-[68vw] sm:w-auto`}
                    style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow, backdropFilter: "blur(16px)" }}>
                    <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: r.accentLine }} />
                    {item.rarity === "legendary" && <div className="shop-legendary-border" />}
                    <span className="shop-today-tag absolute top-3 left-3 text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-gold/20 text-gold border border-gold/30">
                      Today
                    </span>
                    <span className={`absolute top-3 right-3 text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
                    <div className="relative z-[2] p-5 pt-12 flex flex-col h-full">
                      <div className="mb-3 flex items-center justify-center h-16">
                        <Icon size={56} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
                      </div>
                      <h3 className="font-bebas text-xl text-cream tracking-wide mb-0.5 text-center">{item.name}</h3>
                      <p className="text-cream/55 text-[11px] mb-4 leading-relaxed text-center line-clamp-2">{item.description}</p>
                      <div className="flex items-center justify-between mt-auto pt-2 gap-3">
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                          <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
                        </div>
                        {owned ? (
                          <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
                            <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
                          </span>
                        ) : (
                          <button type="button" onClick={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                            disabled={canAfford !== true}
                            aria-label={canAfford === false ? `Not enough Fangs for ${item.name}` : `Buy ${item.name} for ${formatCoins(item.price)} Fangs`}
                            className={`flex-shrink-0 min-h-[44px] px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === true ? "gold-btn shop-btn-pulse focus-visible:ring-gold" : canAfford === false ? "bg-gray-600/20 text-gray-400 cursor-not-allowed border border-gray-600/20 focus-visible:ring-cream/50" : "bg-white/5 text-cream/55 border border-white/10 cursor-wait focus-visible:ring-cream/50"}`}>
                            {canAfford === false ? "Can't Afford" : "Buy"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ══════════ TRENDING (top 3 by 7-day velocity) ══════════ */}
        {!isPremium && trendingItems.length > 0 && (
          <section className="mb-8" aria-labelledby="trending-heading">
            <div className="shop-banner flex items-center justify-between mb-4 px-4 py-3 rounded-xl"
              style={{ background: "linear-gradient(90deg, rgba(249,115,22,0.10), rgba(255,215,0,0.06))", border: "1px solid rgba(249,115,22,0.22)" }}>
              <div className="flex items-center gap-2">
                <TrendUp size={20} weight="fill" color="#F97316" aria-hidden="true" />
                <h2 id="trending-heading" className="font-bebas text-xl tracking-wider" style={{ color: "#F97316" }}>TRENDING</h2>
              </div>
              <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                Hottest picks &middot; last 7 days
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 shop-grid-stagger">
              {trendingItems.map((item, idx) => {
                const r = RARITY_COLORS[item.rarity];
                const Icon = item.Icon;
                const owned = ownedIds.has(item.id);
                const canAfford = affords(item.price);
                return (
                  <div key={item.id}
                    className={`fluid-card-hover shop-card relative rounded-xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden`}
                    style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow, backdropFilter: "blur(12px)" }}>
                    <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: r.accentLine }} />
                    <span className="absolute top-3 left-3 text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(249,115,22,0.15)", color: "#FB923C", border: "1px solid rgba(249,115,22,0.30)" }}>
                      #{idx + 1}
                    </span>
                    <span className={`absolute top-3 right-3 text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
                    <div className="relative z-[2] p-4 pt-10 flex flex-col h-full">
                      <div className="mb-2 flex items-center justify-center h-14">
                        <Icon size={44} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
                      </div>
                      <h4 className="font-bebas text-lg text-cream tracking-wide mb-0.5 text-center">{item.name}</h4>
                      <p className="text-cream/55 text-[11px] mb-3 leading-relaxed text-center line-clamp-2">{item.description}</p>
                      <div className="flex items-center justify-between mt-auto pt-1 gap-3">
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                          <span className="font-bebas text-base text-gold">{formatCoins(item.price)}</span>
                        </div>
                        {owned ? (
                          <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
                            <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
                          </span>
                        ) : (
                          <button type="button" onClick={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                            disabled={canAfford !== true}
                            aria-label={canAfford === false ? `Not enough Fangs for ${item.name}` : `Buy ${item.name} for ${formatCoins(item.price)} Fangs`}
                            className={`flex-shrink-0 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${canAfford === true ? "gold-btn shop-btn-pulse focus-visible:ring-gold" : canAfford === false ? "bg-gray-600/20 text-gray-400 cursor-not-allowed border border-gray-600/20 focus-visible:ring-cream/50" : "bg-white/5 text-cream/55 border border-white/10 cursor-wait focus-visible:ring-cream/50"}`}>
                            {canAfford === false ? "Can't Afford" : "Buy"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ══════════ FOUNDER BADGES (earned / Pro, never Fangs) ══════════ */}
        {!isPremium && (
          <FeatureGate feature="shop.founder_badges" compact>
          <section className="mb-8" aria-labelledby="limited-time-heading">
            <div className="shop-banner flex items-center justify-between mb-4 px-4 py-3 rounded-xl"
              style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.10), rgba(168,85,247,0.06))", border: "1px solid rgba(255,215,0,0.30)" }}>
              <div className="flex items-center gap-2">
                <Crown size={20} weight="fill" color="#FFD700" aria-hidden="true" />
                <h2 id="limited-time-heading" className="font-bebas text-xl text-gold tracking-wider">FOUNDER BADGES</h2>
              </div>
              <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                Earned, not sold &middot; capped forever
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 shop-grid-stagger">
              {FOUNDER_BADGES.map((b) => (
                <div key={b.id} className="fluid-card-hover">
                  <FounderBadgeCard
                    item={b}
                    remaining={founderRemaining(b.id)}
                    owned={cosmeticsOwned.some((c) => c.id === b.id)}
                  />
                </div>
              ))}
            </div>
          </section>
          </FeatureGate>
        )}

        {/* ══════════ PREMIUM STORE ══════════ */}
        {isPremium && (
          <FeatureGate feature="shop.premium_cosmetics" compact>
          <div id="store-panel-premium" role="tabpanel" aria-labelledby="store-tab-premium" className={`${reduce ? "" : "transition-all duration-700 delay-200"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            {/* Coming soon banner */}
            <div className="shop-banner text-center mb-8 py-4 px-6 rounded-2xl mx-auto max-w-lg"
              style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(124,58,237,0.04))", border: "1px solid rgba(168,85,247,0.15)" }}>
              <p className="text-purple-300 text-sm font-semibold mb-1">Premium store launching soon. Stay tuned.</p>
              <p className="text-purple-200/70 text-xs">Exclusive items purchasable with real money via Stripe</p>
            </div>

            {/* Premium tabs */}
            {(() => {
              const PREMIUM_TABS: { key: PremiumTab; label: string; Icon: PhosphorIcon; iconWeight: IconProps["weight"] }[] = [
                { key: "themes", label: "Themes", Icon: Palette, iconWeight: "regular" },
                { key: "frames", label: "Frames", Icon: ImageIcon, iconWeight: "regular" },
                { key: "name_colors", label: "Name Colors", Icon: Rainbow, iconWeight: "fill" },
                { key: "banners", label: "Banners", Icon: FlagBanner, iconWeight: "fill" },
              ];
              return (
                <div role="tablist" aria-label="Premium categories" className="flex items-center justify-center gap-1 sm:gap-2 mb-8">
                  {PREMIUM_TABS.map((t) => {
                    const TabIcon = t.Icon;
                    const selected = premiumTab === t.key;
                    return (
                      <button key={t.key} type="button" role="tab"
                        id={`premium-tab-${t.key}`} aria-selected={selected} aria-controls="premium-tabpanel"
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setPremiumTab(t.key)}
                        onKeyDown={(e) => handleTabKeys(e, (i) => setPremiumTab(PREMIUM_TABS[i].key))}
                        className={`flex items-center gap-1.5 min-h-[44px] px-3 sm:px-5 py-2 rounded-xl text-sm font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                          ${selected ? "bg-purple-500/15 text-purple-300 border border-purple-500/30" : "text-cream/60 hover:text-cream hover:bg-white/5 border border-transparent"}`}>
                        <TabIcon size={16} weight={t.iconWeight} color="currentColor" aria-hidden="true" />
                        <span className="hidden sm:inline">{t.label}</span>
                        <span className="sm:hidden sr-only">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            <div id="premium-tabpanel" role="tabpanel" aria-labelledby={`premium-tab-${premiumTab}`}>
            {/* Themes tab */}
            {premiumTab === "themes" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <div className={`rounded-2xl overflow-hidden border border-purple-500/20 h-full flex flex-col ${reduce ? "" : "transition-transform duration-300 hover:-translate-y-1"}`}
                  style={{ background: "linear-gradient(135deg, rgba(20,8,40,0.9), rgba(10,6,30,0.95))" }}>
                  <div className="h-36 relative overflow-hidden">
                    <img src={cdnUrl("/savannah.png")} alt="Savanna theme preview" className="absolute inset-0 w-full h-full object-cover grayscale-[60%] brightness-75" />
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-black/40 border border-white/10 flex items-center justify-center">
                        <Lock size={24} weight="fill" color="#D8B4FE" aria-hidden="true" />
                      </div>
                    </div>
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-bebas text-xl text-cream tracking-wider">Savanna</p>
                        <p className="text-purple-200/70 text-xs">Wild and golden. Warm light theme.</p>
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-500/30">
                        Epic
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-2 gap-6">
                      <span className="font-bebas text-xl text-purple-300 flex-shrink-0">$2.99</span>
                      <button type="button" disabled aria-disabled="true" aria-label="Savanna theme is coming soon" className="relative flex-shrink-0 min-h-[44px] px-4 py-2 rounded-lg text-xs font-bold border border-purple-500/30 bg-purple-500/10 text-purple-200/80 cursor-not-allowed overflow-hidden">
                        <span className="premium-coming-soon-pulse">Coming Soon</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Premium items grid — filtered by tab */}
            {premiumTab !== "themes" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {PREMIUM_ITEMS
                  .filter((item) => {
                    if (premiumTab === "frames") return item.type === "frame";
                    if (premiumTab === "name_colors") return item.type === "name_color";
                    if (premiumTab === "banners") return item.type === "banner";
                    return false;
                  })
                  .map((item) => (
                    <PremiumCard key={item.id} item={item} />
                  ))}
              </div>
            )}
            </div>
          </div>
          </FeatureGate>
        )}

        {/* ══════════ COIN STORE ══════════ */}
        {!isPremium && (
          <div id="store-panel-coins" role="tabpanel" aria-labelledby="store-tab-coins">
            {/* ── Tabs ── */}
            <div role="tablist" aria-label="Coin store categories" className={`flex items-center justify-center gap-1 sm:gap-2 mb-8 ${reduce ? "" : "transition-all duration-700 delay-100"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
              {TABS.map((t, idx) => {
                const TabIcon = t.Icon;
                const selected = tab === t.key;
                return (
                  <button key={t.key} type="button" role="tab"
                    id={`coin-tab-${t.key}`} aria-selected={selected} aria-controls={`coin-tabpanel-${t.key}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(t.key)}
                    onKeyDown={(e) => handleTabKeys(e, (i) => setTab(TABS[i].key))}
                    className={`flex items-center gap-1.5 min-h-[44px] px-3 sm:px-5 py-2 rounded-xl text-sm font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                      ${selected ? "bg-electric/15 text-electric border border-electric/30" : "text-cream/60 hover:text-cream hover:bg-white/5 border border-transparent"}`}>
                    <TabIcon size={16} weight={t.iconWeight} color="currentColor" aria-hidden="true" />
                    <span className="hidden sm:inline">{t.label}</span>
                    <span className="sm:hidden sr-only">{t.label}</span>
                    {idx === 3 && inventoryKnown && ownedCosmetics.length + ownedBoosters.length + cosmeticsOwned.length > 0 && (
                      <span aria-hidden="true" className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-electric/20 text-electric text-[10px] font-bold border border-electric/30">
                        {ownedCosmetics.length + ownedBoosters.length + cosmeticsOwned.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* FEATURED */}
            {tab === "featured" && (
              <FeatureGate feature="shop.featured" compact>
              <div id="coin-tabpanel-featured" role="tabpanel" aria-labelledby="coin-tab-featured" className={`${reduce ? "" : "transition-all duration-700 delay-200"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                {/* ── NEW THIS WEEK (2026-06-02 SKU drop) ── */}
                <section className="mb-10" aria-labelledby="new-this-week-heading">
                  <div className="shop-banner flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
                    style={{ background: "linear-gradient(90deg, rgba(74,144,217,0.10), rgba(168,85,247,0.08))", border: "1px solid rgba(74,144,217,0.25)" }}>
                    <div className="flex items-center gap-2">
                      <Sparkle size={20} weight="fill" color="#4A90D9" aria-hidden="true" />
                      <h2 id="new-this-week-heading" className="font-bebas text-xl text-electric tracking-wider">NEW THIS WEEK</h2>
                    </div>
                    <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                      Fresh drops &middot; 4 new pickups
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 shop-grid-stagger">
                    {NEW_SKUS.map((item) => (
                      <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} equipped={isEquipped(item.id)} canAfford={affords(item.price)}
                        previewAvatarUrl={previewAvatarUrl} previewUsername={previewUsername}
                        onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                        onEquip={() => { if (!requireLogin()) void handleEquip(item.id); }} />
                    ))}
                    {/* Avatar Aura Pack — surfaced as a single tile that scrolls users into the sub-grid below. */}
                    <div className="shop-card relative rounded-xl overflow-hidden p-4 flex flex-col"
                      style={{ background: "linear-gradient(135deg, rgba(20,8,40,0.85), rgba(6,12,24,0.9))", border: "1px solid rgba(168,85,247,0.30)" }}>
                      <div className="flex items-start justify-between mb-3">
                        <Sphere size={40} weight="fill" color="#A855F7" aria-hidden="true" />
                        <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">Pack</span>
                      </div>
                      <h4 className="font-bebas text-lg text-cream tracking-wide mb-0.5">Avatar Aura Pack</h4>
                      <p className="text-cream/55 text-xs mb-4 leading-relaxed">10 cosmetic auras for your avatar</p>
                      <div className="flex items-center justify-between mt-auto pt-2 gap-3">
                        <div className="flex items-center gap-1.5">
                          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                          <span className="font-bebas text-base text-gold">{formatCoins(Math.min(...AVATAR_AURAS.map((a) => a.price)))} to {formatCoins(Math.max(...AVATAR_AURAS.map((a) => a.price)))}</span>
                        </div>
                        <a href="#avatar-auras" aria-label="Browse avatar auras below" className="inline-flex items-center min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy">Browse</a>
                      </div>
                    </div>
                  </div>

                  {/* Aura sub-grid */}
                  <div id="avatar-auras" className="mt-6">
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60 mb-3">Avatar Auras &middot; pick your vibe</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shop-grid-stagger">
                      {AVATAR_AURAS.map((item) => (
                        <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} equipped={isEquipped(item.id)} canAfford={affords(item.price)}
                          previewAvatarUrl={previewAvatarUrl} previewUsername={previewUsername}
                          onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                          onEquip={() => { if (!requireLogin()) void handleEquip(item.id); }} />
                      ))}
                    </div>
                  </div>
                </section>

                <div className="shop-banner flex items-center justify-between mb-6 px-4 py-3 rounded-xl"
                  style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.06), rgba(168,85,247,0.06))", border: "1px solid rgba(255,215,0,0.15)" }}>
                  <div className="flex items-center gap-2">
                    <Fire size={20} weight="fill" color="#F97316" aria-hidden="true" />
                    <span className="font-bebas text-xl text-gold tracking-wider">WEEKLY FEATURED</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-cream/60 text-xs font-mono">
                    <span>Refreshes in</span>
                    <span className="text-electric font-bold">{countdown.days}d {countdown.hours}h</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 shop-grid-stagger">
                  {FEATURED_ITEMS.map((item) => (
                    <FeaturedCard key={item.id} item={item} owned={ownedIds.has(item.id)} equipped={isEquipped(item.id)}
                      onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                      onEquip={() => { if (!requireLogin()) void handleEquip(item.id); }} />
                  ))}
                </div>
              </div>
              </FeatureGate>
            )}

            {/* COSMETICS */}
            {tab === "cosmetics" && (
              <FeatureGate feature="shop.cosmetics" compact>
              <div id="coin-tabpanel-cosmetics" role="tabpanel" aria-labelledby="coin-tab-cosmetics" className={`${reduce ? "" : "transition-all duration-700 delay-200"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                {/* ── EXCLUSIVE: Founder badges (top of cosmetics tab) ── */}
                {FOUNDER_BADGES.length > 0 && (
                  <FeatureGate feature="shop.founder_badges" compact>
                  <section className="mb-10" aria-labelledby="founder-badges-heading">
                    <div className="shop-banner flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
                      style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.10), rgba(168,85,247,0.06))", border: "1px solid rgba(255,215,0,0.30)" }}>
                      <div className="flex items-center gap-2">
                        <Crown size={20} weight="fill" color="#FFD700" aria-hidden="true" />
                        <h2 id="founder-badges-heading" className="font-bebas text-xl text-gold tracking-wider">EXCLUSIVE &middot; FOUNDER BADGES</h2>
                      </div>
                      <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                        Earned, not sold &middot; capped forever
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {FOUNDER_BADGES.map((b) => (
                        <FounderBadgeCard
                          key={b.id}
                          item={b}
                          remaining={founderRemaining(b.id)}
                          owned={cosmeticsOwned.some((c) => c.id === b.id)}
                        />
                      ))}
                    </div>
                  </section>
                  </FeatureGate>
                )}

                {/* ── IDENTITY: Animated username effects (LIVE PREVIEW) ── */}
                <section className="mb-10" aria-labelledby="identity-heading">
                  <div className="shop-banner flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
                    style={{ background: "linear-gradient(90deg, rgba(168,85,247,0.10), rgba(74,144,217,0.08))", border: "1px solid rgba(168,85,247,0.25)" }}>
                    <div className="flex items-center gap-2">
                      <Rainbow size={20} weight="fill" color="#A855F7" aria-hidden="true" />
                      <h2 id="identity-heading" className="font-bebas text-xl text-purple-300 tracking-wider">USERNAME EFFECTS</h2>
                    </div>
                    <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                      Live preview on YOUR name
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {USERNAME_EFFECTS.map((item) => (
                      <UsernameEffectCard
                        key={item.id}
                        item={item}
                        ownUsername={user?.username ?? "yourname"}
                        owned={ownedIds.has(item.id)}
                        equipped={cosmeticsOwned.some((c) => c.id === item.id && c.equipped) || isEquipped(item.id)}
                        canAfford={affords(item.price)}
                        onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                        onEquip={() => {
                          if (requireLogin()) return;
                          // If currently equipped, unequip — pass empty id so the
                          // /api/me/equip handler clears the slot. Otherwise equip
                          // the cosmetic. The helper falls back to a toast if the
                          // backend route 404s.
                          const currentlyEquipped = cosmeticsOwned.some((c) => c.id === item.id && c.equipped) || isEquipped(item.id);
                          void handleEquipUsernameEffect(currentlyEquipped ? "" : item.id);
                        }}
                      />
                    ))}
                  </div>
                </section>

                {/* ── BANNERS: Premium Fang banners ── */}
                <section className="mb-10" aria-labelledby="premium-fang-banners-heading">
                  <div className="shop-banner flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
                    style={{ background: "linear-gradient(90deg, rgba(74,144,217,0.10), rgba(255,215,0,0.08))", border: "1px solid rgba(74,144,217,0.25)" }}>
                    <div className="flex items-center gap-2">
                      <FlagBanner size={20} weight="fill" color="#4A90D9" aria-hidden="true" />
                      <h2 id="premium-fang-banners-heading" className="font-bebas text-xl text-electric tracking-wider">PREMIUM BANNERS</h2>
                    </div>
                    <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                      Animated &middot; Fang-purchasable
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {PREMIUM_FANG_BANNERS.map((item) => (
                      <PremiumFangBannerCard
                        key={item.id}
                        item={item}
                        owned={ownedIds.has(item.id)}
                        equipped={isEquipped(item.id)}
                        canAfford={affords(item.price)}
                        onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                        onEquip={() => { if (!requireLogin()) void handleEquip(item.id); }}
                      />
                    ))}
                  </div>
                </section>

                {/* ── PREMIUM (cash): real-money banners called out explicitly ── */}
                <FeatureGate feature="shop.premium_cosmetics" compact>
                <section className="mb-10" aria-labelledby="cash-premium-banners-heading">
                  <div className="shop-banner flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
                    style={{ background: "linear-gradient(90deg, rgba(168,85,247,0.10), rgba(168,85,247,0.04))", border: "1px solid rgba(168,85,247,0.30)" }}>
                    <div className="flex items-center gap-2">
                      <Diamond size={20} weight="fill" color="#A855F7" aria-hidden="true" />
                      <h2 id="cash-premium-banners-heading" className="font-bebas text-xl text-purple-300 tracking-wider">PREMIUM &middot; REAL MONEY ONLY</h2>
                    </div>
                    <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                      USD via Stripe &middot; not buyable with Fangs
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {CASH_PREMIUM_BANNERS.map((item) => (
                      <PremiumCard key={item.id} item={item} />
                    ))}
                  </div>
                </section>
                </FeatureGate>

                {/* ── Existing cosmetics sub-tabs (frames / name colors / banners) ── */}
                <div role="tablist" aria-label="Cosmetic type" className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-hide">
                  {COSMETIC_SUBS.map((s) => {
                    const selected = cosmeticSub === s.key;
                    return (
                      <button key={s.key} type="button" role="tab"
                        id={`cosmetic-sub-${s.key}`} aria-selected={selected} aria-controls="cosmetic-sub-panel"
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setCosmeticSub(s.key)}
                        onKeyDown={(e) => handleTabKeys(e, (i) => setCosmeticSub(COSMETIC_SUBS[i].key))}
                        className={`min-h-[44px] px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${selected
                          ? "bg-electric/15 text-electric border border-electric/30"
                          : "text-cream/60 hover:text-cream border border-transparent hover:border-white/10"}`}>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <div id="cosmetic-sub-panel" role="tabpanel" aria-labelledby={`cosmetic-sub-${cosmeticSub}`} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 shop-grid-stagger">
                  {filteredCosmetics.map((item) => (
                    <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} equipped={isEquipped(item.id)} canAfford={affords(item.price)}
                      previewAvatarUrl={previewAvatarUrl} previewUsername={previewUsername}
                      onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                      onEquip={() => { if (!requireLogin()) void handleEquip(item.id); }} />
                  ))}
                  {filteredCosmetics.length === 0 && (
                    <p className="col-span-full text-center text-cream/55 text-sm py-8">No items in this category yet.</p>
                  )}
                </div>
              </div>
              </FeatureGate>
            )}

            {/* BOOSTERS */}
            {tab === "boosters" && (
              <FeatureGate feature="shop.boosters" compact>
              <div id="coin-tabpanel-boosters" role="tabpanel" aria-labelledby="coin-tab-boosters" className={`${reduce ? "" : "transition-all duration-700 delay-200"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                <div className="space-y-3 shop-grid-stagger">
                  {BOOSTER_ITEMS.map((item) => (
                    <BoosterCard key={item.id} item={item} quantityOwned={getQuantity(item.id)} canAfford={affords(item.price)}
                      onBuy={(qty) => { if (!requireLogin()) setConfirmItem({ item, quantity: qty }); }} />
                  ))}
                </div>
              </div>
              </FeatureGate>
            )}

            {/* INVENTORY */}
            {tab === "inventory" && (
              <FeatureGate feature="shop.inventory" compact>
              <div id="coin-tabpanel-inventory" role="tabpanel" aria-labelledby="coin-tab-inventory" className={`${reduce ? "" : "transition-all duration-700 delay-200"} ${mounted || reduce ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                {/* Inventory loading skeleton — gate on the SWR data being
                    undefined so we never flash the empty state before the
                    first fetch resolves. */}
                {user && !inventoryKnown && (
                  <div role="status" aria-live="polite" className="space-y-3 mb-8">
                    <span className="sr-only">Loading your inventory</span>
                    {[0, 1, 2].map((i) => (
                      <div key={i} aria-hidden="true" className="h-[72px] rounded-xl border border-white/10 bg-white/5 motion-safe:animate-pulse" />
                    ))}
                  </div>
                )}
                {/* Themes — always show Interstellar as owned */}
                <div className="mb-8">
                  <h3 className="font-bebas text-xl text-cream/70 tracking-wider mb-4 flex items-center gap-2">
                    <Palette size={20} weight="regular" color="currentColor" aria-hidden="true" /> Themes
                  </h3>
                  <div className="space-y-2">
                    <div className="relative rounded-xl border border-green-500/40 p-4 flex items-center gap-4"
                      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))" }}>
                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-green-500/20 border border-green-500/30 rounded-full px-2 py-0.5">
                        <span className="text-green-400 text-[10px] font-bold uppercase tracking-wider">Active</span>
                      </div>
                      <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-white/10">
                        <img src={cdnUrl("/interstellar.png")} alt="Interstellar" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bebas text-base text-cream tracking-wide">Interstellar</h4>
                          <span className="text-[8px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">Default</span>
                        </div>
                        <p className="text-cream/55 text-xs">Deep space theme with stars and nebula</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Shop V2: Identity & Status — founder + earned + purchased cosmetics
                    unioned with source attribution (purchased / founder / earned). ── */}
                {cosmeticsOwned.length > 0 && (
                  <div className="mb-8">
                    <h3 className="font-bebas text-xl text-cream/70 tracking-wider mb-4 flex items-center gap-2">
                      <Crown size={20} weight="fill" color="#FFD700" aria-hidden="true" /> Identity &amp; Status
                    </h3>
                    <div className="space-y-2">
                      {cosmeticsOwned.map((c) => {
                        const isUsernameEffect = c.type === "username_effect";
                        const isFounder = c.source === "founder";
                        const isEarned = c.source === "earned";
                        const sourceLabel = isFounder ? "Founder" : isEarned ? "Earned" : "Purchased";
                        const sourceColor = isFounder ? "text-gold" : isEarned ? "text-electric" : "text-cream/70";
                        const sourceBg = isFounder ? "bg-gold/15 border-gold/30" : isEarned ? "bg-electric/10 border-electric/30" : "bg-white/5 border-white/10";
                        // Resolve a human label from the catalog / founder set;
                        // fall back to a Title-Cased version of the raw id so the
                        // row never shows an ugly snake_case identifier.
                        const displayName = displayNameForCosmetic(c.id);
                        return (
                          <div key={c.id} className="relative rounded-xl border border-white/10 p-4 flex items-center gap-3"
                            style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))" }}>
                            <div className={`px-2 py-0.5 rounded-full border ${sourceBg} flex items-center gap-1 flex-shrink-0`}>
                              <span className={`text-[9px] uppercase tracking-wider font-bold ${sourceColor}`}>{sourceLabel}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bebas text-base text-cream tracking-wide truncate">{displayName}</p>
                              <p className="text-cream/55 text-[11px] capitalize">{(c.type ?? "").replace(/_/g, " ")}</p>
                            </div>
                            {isUsernameEffect && (
                              <button
                                type="button"
                                onClick={() => handleEquipUsernameEffect(c.equipped ? "" : c.id)}
                                aria-pressed={c.equipped}
                                aria-label={c.equipped ? `${displayName} equipped, activate to unequip` : `Equip ${displayName}`}
                                className={`flex-shrink-0 min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
                                  c.equipped
                                    ? "border border-green-500/40 text-green-400 hover:bg-green-500/10 focus-visible:ring-green-400"
                                    : "border border-electric/40 text-electric hover:bg-electric/10 focus-visible:ring-electric"
                                }`}
                              >
                                {c.equipped ? "Equipped" : "Equip"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Genuine empty state — only after inventory has resolved (never
                    flash it while the first fetch is in flight). */}
                {inventoryKnown && ownedCosmetics.length === 0 && ownedBoosters.length === 0 && cosmeticsOwned.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-cream/55 text-sm">Purchase items from the shop to add them to your inventory.</p>
                    <button type="button" onClick={() => setTab("featured")} className="mt-4 btn-outline min-h-[44px] px-6 py-2.5 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-navy">Browse Shop</button>
                  </div>
                ) : (
                  <>
                    {ownedCosmetics.length > 0 && (
                      <div className="mb-8">
                        <h3 className="font-bebas text-xl text-cream/70 tracking-wider mb-4 flex items-center gap-2">
                          <Palette size={20} weight="regular" color="currentColor" aria-hidden="true" /> Cosmetics
                        </h3>
                        <div className="space-y-2">
                          {ownedCosmetics.map((owned) => {
                            const item = findItem(owned.itemId); if (!item) return null;
                            return <InventoryItem key={owned.itemId} item={item} owned={owned} onEquip={() => handleEquip(owned.itemId)} />;
                          })}
                        </div>
                      </div>
                    )}
                    {ownedBoosters.length > 0 && (
                      <div>
                        <h3 className="font-bebas text-xl text-cream/70 tracking-wider mb-4 flex items-center gap-2">
                          <Rocket size={20} weight="regular" color="currentColor" aria-hidden="true" /> Boosters
                        </h3>
                        <div className="space-y-2">
                          {ownedBoosters.map((owned) => {
                            const item = findItem(owned.itemId); if (!item) return null;
                            return <InventoryItem key={owned.itemId} item={item} owned={owned} onEquip={() => { }} />;
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              </FeatureGate>
            )}
          </div>
        )}
      </div>
    </div>
    </FeatureGate>
  );
}
