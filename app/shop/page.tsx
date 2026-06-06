"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCoins } from "@/lib/mockData";
import { cdnUrl } from "@/lib/cdn";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";
import DailySpinHero from "@/components/Shop/DailySpinHero";
import AnimatedUsername, { type UsernameEffect } from "@/components/AnimatedUsername";
import { todaysDrops as pickTodaysDrops } from "@/lib/shop-daily-drops";
import type { ShopItem as CoreShopItem } from "@lionade/core/constants/shop-catalog";
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
type ItemType = "frame" | "background" | "name_color" | "banner" | "booster" | "username_effect" | "animated_banner" | "founder_badge" | "earned_medal" | "profile_flair";
type BoosterEffect = "coin_multiplier" | "xp_multiplier" | "extra_time" | "auto_correct" | "fifty_fifty" | "score_boost" | "streak_shield";
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
// ── Coin Store Items ──
// ══════════════════════════════════════════

const FEATURED_ITEMS: ShopItem[] = [
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 500, Icon: PawPrint, iconWeight: "fill", iconColor: "#FFD700" },
  { id: "boost_coin_rush", name: "Coin Rush", description: "2x coins for your next quiz", type: "booster", rarity: "rare", price: 75, Icon: Coins, iconWeight: "fill", iconColor: "#FFD700", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis name effect", type: "name_color", rarity: "legendary", price: 450, Icon: Rainbow, iconWeight: "fill" },
];

const COSMETIC_ITEMS: ShopItem[] = [
  { id: "frame_basic_blue", name: "Electric Blue", description: "Clean electric blue border", type: "frame", rarity: "common", price: 25, Icon: Circle, iconWeight: "fill", iconColor: "#4A90D9" },
  { id: "frame_fire", name: "Inferno Ring", description: "Burning ring of fire around your avatar", type: "frame", rarity: "rare", price: 100, Icon: Fire, iconWeight: "fill", iconColor: "#F97316" },
  { id: "frame_crystal", name: "Crystal Prism", description: "Refracting crystal light frame", type: "frame", rarity: "epic", price: 250, Icon: Diamond, iconWeight: "fill", iconColor: "#A855F7" },
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 500, Icon: PawPrint, iconWeight: "fill", iconColor: "#FFD700" },
  { id: "name_ice", name: "Ice Blue", description: "Frosty ice blue name", type: "name_color", rarity: "common", price: 20, Icon: Snowflake, iconWeight: "regular", iconColor: "#7DD3FC" },
  { id: "name_emerald", name: "Emerald Green", description: "Rich emerald name color", type: "name_color", rarity: "rare", price: 90, Icon: Heart, iconWeight: "fill", iconColor: "#22C55E" },
  { id: "name_amethyst", name: "Amethyst Purple", description: "Deep amethyst glow", type: "name_color", rarity: "epic", price: 200, Icon: Heart, iconWeight: "fill", iconColor: "#A855F7" },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis effect", type: "name_color", rarity: "legendary", price: 450, Icon: Rainbow, iconWeight: "fill" },
  { id: "banner_starter", name: "Starter Banner", description: "Simple gradient banner", type: "banner", rarity: "common", price: 15, Icon: Flag, iconWeight: "regular", iconColor: "#94A3B8" },
  { id: "banner_warrior", name: "Warrior Banner", description: "Battle-worn warrior flag", type: "banner", rarity: "rare", price: 120, Icon: Sword, iconWeight: "fill", iconColor: "#60A5FA" },
  { id: "banner_galaxy", name: "Galaxy Banner", description: "Full galaxy panorama", type: "banner", rarity: "epic", price: 280, Icon: Sparkle, iconWeight: "fill", iconColor: "#A855F7" },
  { id: "banner_legend", name: "Legend Banner", description: "Only for the truly legendary", type: "banner", rarity: "legendary", price: 750, Icon: Crown, iconWeight: "fill", iconColor: "#FFD700" },
];

const BOOSTER_ITEMS: ShopItem[] = [
  { id: "boost_coin_rush", name: "Coin Rush", description: "2x coins earned on your next quiz", type: "booster", rarity: "rare", price: 75, Icon: Coins, iconWeight: "fill", iconColor: "#FFD700", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_xp_surge", name: "XP Surge", description: "2x XP earned on your next quiz", type: "booster", rarity: "rare", price: 75, Icon: Lightning, iconWeight: "fill", iconColor: "#FACC15", boosterEffect: "xp_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_streak_shield", name: "Streak Shield", description: "Protects your streak for one missed day", type: "booster", rarity: "epic", price: 150, Icon: Shield, iconWeight: "fill", iconColor: "#A855F7", boosterEffect: "streak_shield", boosterValue: 0, boosterDuration: 1 },
  { id: "boost_double_down", name: "Double Down", description: "Double coins AND XP on next quiz", type: "booster", rarity: "epic", price: 200, Icon: DiceFive, iconWeight: "regular", iconColor: "#A855F7", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_lucky_start", name: "Lucky Start", description: "First question auto-correct", type: "booster", rarity: "rare", price: 100, Icon: Leaf, iconWeight: "fill", iconColor: "#22C55E", boosterEffect: "auto_correct", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_time_warp", name: "Time Warp", description: "+10 seconds per question", type: "booster", rarity: "common", price: 40, Icon: CircleNotch, iconWeight: "bold", iconColor: "#94A3B8", boosterEffect: "extra_time", boosterValue: 10, boosterDuration: 1 },
  { id: "boost_brain_freeze", name: "Brain Freeze", description: "50/50. Eliminate two wrong answers once.", type: "booster", rarity: "epic", price: 125, Icon: Snowflake, iconWeight: "regular", iconColor: "#7DD3FC", boosterEffect: "fifty_fifty", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_score_boost", name: "Score Boost", description: "+1 added to your final score", type: "booster", rarity: "common", price: 50, Icon: TrendUp, iconWeight: "regular", iconColor: "#94A3B8", boosterEffect: "score_boost", boosterValue: 1, boosterDuration: 1 },
];

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
// ── New shop SKUs (2026-06-02) ──
// Frontend mirror of the 4 new catalog entries the backend agent is shipping.
// Ids match the backend canonical list so /api/shop/purchase resolves price
// server-side. UI-only metadata (Icon, color) lives here.
// ══════════════════════════════════════════
const NEW_SKUS: ShopItem[] = [
  { id: "mastery_hint_pack", name: "Mastery Hint Pack", description: "5 hints to use on any Mastery question", type: "booster", rarity: "rare", price: 300, Icon: Lightning, iconWeight: "fill", iconColor: "#FACC15", boosterEffect: "fifty_fifty", boosterValue: 5, boosterDuration: 5 },
  { id: "streak_shield_3pack", name: "Streak Shield 3-Pack", description: "Three Streak Shields. Protects three missed days.", type: "booster", rarity: "epic", price: 400, Icon: Shield, iconWeight: "fill", iconColor: "#A855F7", boosterEffect: "streak_shield", boosterValue: 0, boosterDuration: 3 },
  { id: "ninny_voice_skin", name: "Ninny Voice Skin", description: "Unlock a fresh voice for Ninny's reads", type: "frame", rarity: "epic", price: 500, Icon: Sparkle, iconWeight: "fill", iconColor: "#A855F7" },
];

// 10 Avatar Auras rendered as a sub-grid under the "New this week" section.
const AVATAR_AURAS: ShopItem[] = [
  { id: "aura_solar",   name: "Solar Aura",   description: "Warm golden halo",         type: "frame", rarity: "rare",      price: 200, Icon: Sphere, iconWeight: "fill", iconColor: "#FACC15" },
  { id: "aura_aurora",  name: "Aurora Aura",  description: "Shifting borealis ring",   type: "frame", rarity: "epic",      price: 350, Icon: Rainbow, iconWeight: "fill", iconColor: "#A855F7" },
  { id: "aura_storm",   name: "Storm Aura",   description: "Crackling lightning ring", type: "frame", rarity: "epic",      price: 350, Icon: Lightning, iconWeight: "fill", iconColor: "#60A5FA" },
  { id: "aura_emerald", name: "Emerald Aura", description: "Lush emerald glow",        type: "frame", rarity: "rare",      price: 200, Icon: Heart, iconWeight: "fill", iconColor: "#22C55E" },
  { id: "aura_rose",    name: "Rose Aura",    description: "Soft rose-quartz shimmer", type: "frame", rarity: "rare",      price: 200, Icon: Heart, iconWeight: "fill", iconColor: "#FB7185" },
  { id: "aura_void",    name: "Void Aura",    description: "Pulsing dark-matter ring", type: "frame", rarity: "legendary", price: 400, Icon: CircleNotch, iconWeight: "bold", iconColor: "#A855F7" },
  { id: "aura_amber",   name: "Amber Aura",   description: "Slow amber pulse",         type: "frame", rarity: "rare",      price: 250, Icon: Fire, iconWeight: "fill", iconColor: "#F97316" },
  { id: "aura_frost",   name: "Frost Aura",   description: "Crystalline frost ring",   type: "frame", rarity: "rare",      price: 250, Icon: Snowflake, iconWeight: "regular", iconColor: "#7DD3FC" },
  { id: "aura_ember",   name: "Ember Aura",   description: "Drifting ember sparks",    type: "frame", rarity: "epic",      price: 350, Icon: Flame, iconWeight: "fill", iconColor: "#F97316" },
  { id: "aura_lunar",   name: "Lunar Aura",   description: "Silver moonlight halo",    type: "frame", rarity: "legendary", price: 400, Icon: StarFour, iconWeight: "fill", iconColor: "#E8EAF2" },
];

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
const USERNAME_EFFECTS: UsernameEffectSKU[] = [
  { id: "name_fx_rainbow",      name: "Rainbow Shimmer", description: "Animated rainbow shimmer across your username", type: "username_effect", rarity: "rare",      price: 1500, Icon: Rainbow,    iconWeight: "fill",                          effect: "rainbow"     },
  { id: "name_fx_fire",         name: "Fire Effect",     description: "Flickering flames trace your username",         type: "username_effect", rarity: "rare",      price: 2000, Icon: Fire,       iconWeight: "fill", iconColor: "#F97316",    effect: "fire"        },
  { id: "name_fx_holographic",  name: "Holographic",     description: "Iridescent holographic sweep over your username", type: "username_effect", rarity: "epic",      price: 3000, Icon: Sphere,     iconWeight: "fill", iconColor: "#A855F7",    effect: "holographic" },
  { id: "name_fx_gold",         name: "Gold Sheen",      description: "Polished gold sheen on every letter",           type: "username_effect", rarity: "epic",      price: 2500, Icon: Medal,      iconWeight: "fill", iconColor: "#FFD700",    effect: "gold"        },
  { id: "name_fx_glitch",       name: "Glitch",          description: "Digital glitch distortion on your username",    type: "username_effect", rarity: "epic",      price: 3500, Icon: Lightning,  iconWeight: "fill", iconColor: "#60A5FA",    effect: "glitch"      },
  { id: "name_fx_galaxy",       name: "Galaxy Shimmer",  description: "Drifting galaxy starfield inside your letters", type: "username_effect", rarity: "legendary", price: 5000, Icon: Sparkle,    iconWeight: "fill", iconColor: "#A855F7",    effect: "galaxy"      },
];

// 5 premium Fang banners (animated, high price, Fang-only). Ids match the
// `animated_banner` entries in packages/lionade-core/src/constants/shop-catalog.ts
// so /api/shop/purchase resolves price + type server-side.
const PREMIUM_FANG_BANNERS: ShopItem[] = [
  { id: "banner_interstellar", name: "Interstellar", description: "Drifting star particles across deep space",  type: "animated_banner", rarity: "epic",      price: 3000, Icon: Sparkle,    iconWeight: "fill",                       },
  { id: "banner_aurora",       name: "Aurora",       description: "Northern lights gradient flowing edge to edge", type: "animated_banner", rarity: "epic",      price: 3500, Icon: Rainbow,    iconWeight: "fill", iconColor: "#22D3EE"  },
  { id: "banner_ink_splash",   name: "Ink Splash",   description: "Animated ink drops blooming across the banner", type: "animated_banner", rarity: "epic",      price: 4000, Icon: CircleNotch,iconWeight: "bold", iconColor: "#94A3B8"  },
  { id: "banner_honeycomb",    name: "Honeycomb",    description: "Geometric honeycomb pattern with soft shimmer", type: "animated_banner", rarity: "epic",      price: 4500, Icon: Diamond,    iconWeight: "fill", iconColor: "#FACC15"  },
  { id: "banner_tidewave",     name: "Tidewave",     description: "Gentle ocean wave motion across the banner",    type: "animated_banner", rarity: "legendary", price: 5000, Icon: Heart,      iconWeight: "fill", iconColor: "#22C55E"  },
];

// 4 cash-premium banners (USD only — Stripe IAP)
const CASH_PREMIUM_BANNERS: PremiumItem[] = [
  { id: "prem_banner_eclipse",   name: "Eclipse",         description: "Ringed eclipse with corona shimmer",      type: "banner", rarity: "legendary", priceUSD: 5.99, Icon: Diamond,    iconWeight: "fill", iconColor: "#FFD700" },
  { id: "prem_banner_aurora_x",  name: "Aurora Pro",      description: "High-fidelity aurora with parallax stars",type: "banner", rarity: "legendary", priceUSD: 4.99, Icon: Rainbow,    iconWeight: "fill"                       },
  { id: "prem_banner_nebula",    name: "Nebula Drift",    description: "Drifting nebula with dust particles",     type: "banner", rarity: "epic",      priceUSD: 3.99, Icon: Sphere,     iconWeight: "fill", iconColor: "#A855F7" },
  { id: "prem_banner_chromium",  name: "Chromium",        description: "Reactive chrome surface that catches light",type: "banner", rarity: "epic",    priceUSD: 3.49, Icon: DiamondsFour,iconWeight: "fill", iconColor: "#E8EAF2" },
];

// 3 founder badges — capped supply, server enforces remaining count.
interface FounderBadgeSKU {
  id: string;
  name: string;
  tagline: string;
  cap: number;
  price: number;
  Icon: PhosphorIcon;
  iconColor: string;
}
const FOUNDER_BADGES: FounderBadgeSKU[] = [
  { id: "founder_lionade_og",    name: "Lionade OG",      tagline: "First 1,000 supporters. Forever.",      cap: 1000, price: 5000,  Icon: Crown,  iconColor: "#FFD700" },
  { id: "founder_beta_witness",  name: "Beta Witness",    tagline: "You were here before launch.",          cap: 500,  price: 3500,  Icon: Star,   iconColor: "#A855F7" },
  { id: "founder_day_one",       name: "Day One Pride",   tagline: "Caught the very first sunrise.",        cap: 100,  price: 10000, Icon: PawPrint, iconColor: "#FFD700" },
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
  useEffect(() => { const t = setTimeout(onDone, 1200); return () => clearTimeout(t); }, [onDone]);
  const particles = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * 360;
    const dist = 40 + Math.random() * 60;
    return { id: i, dx: Math.cos((angle * Math.PI) / 180) * dist, dy: Math.sin((angle * Math.PI) / 180) * dist, delay: Math.random() * 0.15, size: 3 + Math.random() * 4 };
  });
  return (
    <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center">
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
function ConfirmModal({ item, quantity, onConfirm, onCancel, userCoins }: {
  item: ShopItem; quantity: number; onConfirm: () => void; onCancel: () => void; userCoins: number;
}) {
  const totalPrice = item.price * quantity;
  const canAfford = userCoins >= totalPrice;
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="shop-card relative w-full max-w-sm rounded-2xl p-6 animate-slide-up overflow-hidden"
        style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow }}
        onClick={(e) => e.stopPropagation()}>
        <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: r.accentLine }} />
        <div className="text-center mb-6">
          <div className="mb-3 flex items-center justify-center">
            <Icon size={52} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
          </div>
          <h3 className="font-bebas text-2xl text-cream tracking-wide">{item.name}</h3>
          <span className={`inline-block mt-1 text-[10px] uppercase tracking-widest font-bold px-2.5 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <div className="flex items-center justify-center gap-2 mb-6 py-3 rounded-xl" style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}>
          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
          <span className="font-bebas text-3xl text-gold">{formatCoins(totalPrice)}</span>
          {quantity > 1 && <span className="text-cream/60 text-sm ml-1">(x{quantity})</span>}
        </div>
        {!canAfford && <p className="text-red-400 text-xs text-center mb-4 font-semibold">Not enough Fangs. You need {formatCoins(totalPrice - userCoins)} more.</p>}
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-electric/20 text-cream/60 text-sm font-bold hover:bg-white/5 transition-all">Cancel</button>
          <button onClick={onConfirm} disabled={!canAfford}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse cursor-pointer" : "bg-gray-600/30 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
            {canAfford ? "Confirm Purchase" : "Can't Afford"}
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
              onClick={onEquip}
              className={`flex-shrink-0 px-5 py-2 rounded-xl text-sm font-bold transition-all ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10" : "border border-electric/30 text-electric hover:bg-electric/10"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1.5 text-green-400 text-sm font-bold">
              <Check size={16} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button onClick={onBuy} className="gold-btn shop-btn-pulse px-5 py-2 rounded-xl text-sm font-bold flex-shrink-0">Buy Now</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cosmetic Card ──
// Bucket C 2026-06-05: equipped frames / name colors / banners now expose an
// inline "Unequip" CTA next to the green Equipped pill so users can clear the
// slot without going to Inventory. Owned-but-not-equipped state gets a quiet
// "Equip" CTA so the shop also doubles as a quick re-equip surface. Callers
// pass `equipped` + `onEquip` from the same handleEquip path that the
// Inventory tab uses, so behavior is consistent across surfaces.
function CosmeticCard({ item, owned, equipped = false, canAfford, onBuy, onEquip }: { item: ShopItem; owned: boolean; equipped?: boolean; canAfford: boolean; onBuy: () => void; onEquip?: () => void }) {
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  // Boosters are equipped-by-use, not by toggle — never show the equip CTA on them.
  const isCosmetic = item.type !== "booster";
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
          <div className="shop-item-icon">
            <Icon size={40} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
          </div>
          <div className="flex items-center gap-1.5">
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
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned && isCosmetic && onEquip ? (
            <button
              onClick={onEquip}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10" : "border border-electric/30 text-electric hover:bg-electric/10"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
              <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button onClick={onBuy} disabled={!canAfford}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse" : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
              {canAfford ? "Buy" : "Can't Afford"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Booster Card ──
function BoosterCard({ item, quantityOwned, canAfford, onBuy }: { item: ShopItem; quantityOwned: number; canAfford: boolean; onBuy: (qty: number) => void }) {
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
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => onBuy(1)} disabled={!canAfford}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse" : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(item.price)} &middot; Buy x1
            </button>
            <button onClick={() => onBuy(5)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-electric/30 text-electric hover:bg-electric/10">
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(bulkPrice)} &middot; Buy x5 <span className="text-green-400 text-[10px]">(save 10%)</span>
            </button>
          </div>
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
          <button onClick={onEquip}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${owned.equipped ? "border border-green-500/30 text-green-400 hover:bg-green-500/10" : "border border-electric/30 text-electric hover:bg-electric/10"}`}>
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
          <button disabled className="relative flex-shrink-0 px-4 py-2 rounded-lg text-xs font-bold border border-purple-500/30 bg-purple-500/8 text-purple-300/60 cursor-not-allowed">
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
  canAfford: boolean;
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
              onClick={onEquip}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10" : "border border-electric/30 text-electric hover:bg-electric/10"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
              <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button onClick={onBuy} disabled={!canAfford}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse" : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
              {canAfford ? "Buy" : "Can't Afford"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Premium Fang banner card — small looping preview tile.
function PremiumFangBannerCard({ item, owned, equipped = false, canAfford, onBuy, onEquip }: { item: ShopItem; owned: boolean; equipped?: boolean; canAfford: boolean; onBuy: () => void; onEquip?: () => void }) {
  const r = RARITY_COLORS[item.rarity];
  // animated_banner is a cosmetic — equip CTA always available when owned.
  const isCosmetic = item.type !== "booster";
  const Icon = item.Icon;
  return (
    <div className={`fluid-card-hover shop-card relative rounded-xl ${r.glow} ${item.rarity === "legendary" ? "shop-legendary-sparkle shop-tier-sweep-legendary" : ""} overflow-hidden h-full flex flex-col`}
      style={{ background: r.cardBg, border: `1.5px solid ${r.cardBorder}`, boxShadow: r.cardShadow, backdropFilter: "blur(12px)" }}>
      <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] z-[1]" style={{ background: r.accentLine }} />
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative z-[2] p-4 flex flex-col flex-1">
        {/* Looping preview tile (gradient swatch + icon). */}
        <div className="h-16 rounded-lg mb-3 relative overflow-hidden border border-white/5"
          style={{
            background: item.rarity === "legendary"
              ? "linear-gradient(120deg, rgba(255,215,0,0.25), rgba(168,85,247,0.15), rgba(74,144,217,0.25))"
              : item.rarity === "epic"
              ? "linear-gradient(120deg, rgba(168,85,247,0.20), rgba(74,144,217,0.15))"
              : "linear-gradient(120deg, rgba(74,144,217,0.15), rgba(34,197,94,0.10))",
            backgroundSize: "200% 100%",
            animation: "au-name-rainbow 6s linear infinite",
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
              onClick={onEquip}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${equipped ? "border border-green-500/40 text-green-400 hover:bg-green-500/10" : "border border-electric/30 text-electric hover:bg-electric/10"}`}
            >
              {equipped ? "Unequip" : "Equip"}
            </button>
          ) : owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
              <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Owned
            </span>
          ) : (
            <button onClick={onBuy} disabled={!canAfford}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse" : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
              {canAfford ? "Buy" : "Can't Afford"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Founder badge card with cap countdown + sold-out overlay.
function FounderBadgeCard({
  item, remaining, owned, canAfford, onBuy,
}: {
  item: FounderBadgeSKU;
  remaining: number | null;
  owned: boolean;
  canAfford: boolean;
  onBuy: () => void;
}) {
  const Icon = item.Icon;
  const soldOut = remaining !== null && remaining <= 0;
  return (
    <div className="fluid-card-hover shop-card shop-legendary-sparkle relative rounded-2xl overflow-hidden h-full flex flex-col"
      style={{
        background: "linear-gradient(135deg, rgba(40,28,8,0.95), rgba(8,6,16,0.95))",
        border: `1px solid ${soldOut ? "rgba(156,163,175,0.20)" : "rgba(255,215,0,0.35)"}`,
        backdropFilter: "blur(16px)",
      }}>
      {soldOut && (
        <div className="absolute inset-0 z-10 bg-black/55 backdrop-blur-sm flex flex-col items-center justify-center">
          <Lock size={32} weight="fill" color="#9CA3AF" aria-hidden="true" />
          <p className="font-bebas text-xl text-cream/70 tracking-wider mt-2">SOLD OUT</p>
          <p className="text-cream/40 text-[10px] font-mono uppercase tracking-[0.22em] mt-0.5">All {item.cap.toLocaleString()} claimed</p>
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

        {/* FOMO counter — `1 of 1000 — 247 remaining` */}
        <div className="text-center mb-4 py-2 rounded-lg" style={{ background: "rgba(255,215,0,0.05)", border: "1px solid rgba(255,215,0,0.12)" }}>
          {remaining === null ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40">Cap of {item.cap.toLocaleString()}</p>
          ) : (
            <>
              <p className="font-bebas text-xl text-gold tracking-wider leading-none">{remaining.toLocaleString()}</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/45 mt-0.5">
                of {item.cap.toLocaleString()} remaining
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between mt-auto pt-1 gap-3">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0">
              <Check size={14} weight="bold" color="#22C55E" aria-hidden="true" /> Yours
            </span>
          ) : (
            <button onClick={onBuy} disabled={!canAfford || soldOut}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                soldOut
                  ? "bg-gray-700/30 text-gray-500 cursor-not-allowed border border-gray-600/20"
                  : canAfford
                  ? "gold-btn shop-btn-pulse"
                  : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"
              }`}>
              {soldOut ? "Sold Out" : canAfford ? "Claim" : "Can't Afford"}
            </button>
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
                className={`mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 px-4 text-sm font-bold transition-all ${
                  disabled
                    ? "bg-white/[0.04] text-cream/30 border border-white/[0.06] cursor-not-allowed"
                    : "gold-btn shop-btn-pulse"
                } ${isPending ? "opacity-80 cursor-wait" : ""}`}
              >
                {isPending ? (
                  <>
                    <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
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

      <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/30 mt-4">
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

  // Shop V2 — earned + founder cosmetics ride on a separate endpoint with
  // `source` attribution (purchased / founder / earned). Inventory tab unions
  // both lists so all owned cosmetics are visible in one place.
  const cosmeticsOwnedKey = user?.id ? `cosmetics-owned/${user.id}` : null;
  const { data: cosmeticsOwnedData, mutate: mutateCosmeticsOwned } = useSWR(
    cosmeticsOwnedKey,
    () => apiGet<{ items: { id: string; type: string; source: "purchased" | "founder" | "earned"; equipped?: boolean }[] }>("/api/cosmetics/owned"),
    { dedupingInterval: 60_000, keepPreviousData: true, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const cosmeticsOwned = cosmeticsOwnedData?.ok ? (cosmeticsOwnedData.data?.items ?? []) : [];

  // Shop V2 — founder badge cap counts. Endpoint returns remaining per id.
  // Defaults to `null` (count unknown / cap closed unclear) if not yet shipped.
  const founderCapsKey = user?.id ? `founder-caps/${user.id}` : null;
  const { data: founderCapsData } = useSWR(
    founderCapsKey,
    () => apiGet<{ caps: Record<string, number> }>("/api/shop/founder-caps"),
    { dedupingInterval: 30_000, keepPreviousData: true, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const founderCaps: Record<string, number> = founderCapsData?.ok ? (founderCapsData.data?.caps ?? {}) : {};

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
        <p className="font-bebas text-2xl text-electric tracking-widest">LOADING...</p>
      </div>
    </div>
  );

  const userCoins = stats?.coins ?? user?.coins ?? 0;
  // Flash-of-zero gate (CLAUDE.md non-negotiable): the header balance pill
  // must not render "0" before stats/user resolve. Once either source has
  // delivered a number we lock the display in; downstream affordances
  // (canAfford / Buy disabled) keep using userCoins so the math stays honest.
  const balanceKnown = typeof stats?.coins === "number" || typeof user?.coins === "number";
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
    setPurchasing(true);
    // Server reads price from the catalog — we only send itemId + quantity
    const res = await apiPost("/api/shop/purchase", {
      itemId: confirmItem.item.id,
      quantity: confirmItem.quantity,
    });
    if (res.ok) {
      setShowBurst(true);
      await refreshUser();
      await mutateInventory();
    }
    setPurchasing(false);
    setConfirmItem(null);
  };

  const handleEquip = async (itemId: string) => {
    if (!user) return;
    await apiPost("/api/shop/equip", { itemId });
    await mutateInventory();
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
    const pool = allItems as unknown as CoreShopItem[];
    const picked = pickTodaysDrops(pool, new Date(), 5);
    const pickedIds = new Set(picked.map((p) => p.id));
    return allItems.filter((i) => pickedIds.has(i.id));
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
      .map((id) => allItems.find((i) => i.id === id))
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

  // ── Limited time (founder badges with caps still open) ──
  // V1: only the FOUNDER_BADGES set. Filter to "remaining > 0 OR remaining
  // unknown". If everything is sold out / owned, the section hides entirely.
  const limitedTimeBadges = FOUNDER_BADGES.filter((b) => {
    const r = founderCaps[b.id];
    return r === undefined || r > 0;
  });

  // Shop V2 — equip a username effect via PATCH /api/me/equip. Endpoint may
  // not yet be live (backend follow-up flagged in the vault note). Falls back
  // to a polite toast if the route 404s.
  const handleEquipUsernameEffect = async (cosmeticId: string) => {
    if (!user) return;
    const res = await apiPost("/api/me/equip", { slot: "username_effect", cosmetic_id: cosmeticId });
    if (!res.ok) {
      console.error("[shop:equip-username-effect] failed", res.error);
      toastError("Couldn't equip that yet. Try again shortly.");
      return;
    }
    toastSuccess("Equipped");
    await Promise.all([mutateInventory(), mutateCosmeticsOwned()]);
  };

  const isPremium = storeMode === "premium";

  return (
    <div className={`min-h-screen pt-16 pb-24 md:pb-12 transition-colors duration-500 ${isPremium ? "premium-store-bg" : ""}`}>
      {showBurst && <PurchaseBurst onDone={() => setShowBurst(false)} />}
      {confirmItem && <ConfirmModal item={confirmItem.item} quantity={confirmItem.quantity} onConfirm={handlePurchase} onCancel={() => setConfirmItem(null)} userCoins={userCoins} />}

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ── Header ── */}
        <div className={`relative text-center mb-6 transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
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
        <div className={`flex items-center justify-center mb-8 transition-all duration-700 delay-75 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          <div className="shop-toggle relative flex items-center rounded-full p-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* Sliding indicator */}
            <div className="absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-out"
              style={{
                width: "calc(50% - 4px)",
                left: isPremium ? "calc(50% + 2px)" : "4px",
                background: isPremium
                  ? "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(124,58,237,0.15))"
                  : "linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,165,0,0.1))",
                border: isPremium ? "1px solid rgba(168,85,247,0.3)" : "1px solid rgba(255,215,0,0.25)",
              }} />

            <button onClick={() => setStoreMode("coins")}
              className={`relative z-10 flex items-center gap-2 px-5 sm:px-7 py-2.5 rounded-full text-sm font-bold transition-all duration-200 ${!isPremium ? "text-gold" : "text-cream/60 hover:text-cream/60"}`}>
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> Coin Store
            </button>
            <button onClick={() => setStoreMode("premium")}
              className={`relative z-10 flex items-center gap-2 px-5 sm:px-7 py-2.5 rounded-full text-sm font-bold transition-all duration-200 ${isPremium ? "text-purple-300" : "text-cream/60 hover:text-cream/60"}`}>
              <Diamond size={18} weight="fill" color={isPremium ? "#D8B4FE" : "currentColor"} aria-hidden="true" /> Premium Store
            </button>
          </div>
        </div>

        {/* ══════════ BUY FANGS (Stripe IAP, coin store only) ══════════ */}
        {!isPremium && (
          <div className={`transition-all duration-700 delay-150 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            <BuyFangsSection
              isAuthed={!!user}
              onUnauthed={() => router.push("/login?next=/shop")}
            />
          </div>
        )}

        {/* ══════════ DAILY SPIN HERO (coin store only) ══════════ */}
        {!isPremium && <DailySpinHero />}

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
                const canAfford = userCoins >= item.price;
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
                          <button onClick={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                            disabled={!canAfford}
                            className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse" : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
                            {canAfford ? "Buy" : "Can't Afford"}
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
                const canAfford = userCoins >= item.price;
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
                          <button onClick={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                            disabled={!canAfford}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse" : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
                            {canAfford ? "Buy" : "Can't Afford"}
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

        {/* ══════════ LIMITED TIME (founder badges still purchasable) ══════════ */}
        {!isPremium && limitedTimeBadges.length > 0 && (
          <section className="mb-8" aria-labelledby="limited-time-heading">
            <div className="shop-banner flex items-center justify-between mb-4 px-4 py-3 rounded-xl"
              style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.10), rgba(168,85,247,0.06))", border: "1px solid rgba(255,215,0,0.30)" }}>
              <div className="flex items-center gap-2">
                <Crown size={20} weight="fill" color="#FFD700" aria-hidden="true" />
                <h2 id="limited-time-heading" className="font-bebas text-xl text-gold tracking-wider">LIMITED TIME</h2>
              </div>
              <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                Capped supply &middot; once they&apos;re gone, they&apos;re gone
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 shop-grid-stagger">
              {limitedTimeBadges.map((b) => {
                const remaining = founderCaps[b.id] ?? null;
                const owned = cosmeticsOwned.some((c) => c.id === b.id);
                return (
                  <div key={b.id} className="fluid-card-hover">
                    <FounderBadgeCard
                      item={b}
                      remaining={remaining}
                      owned={owned}
                      canAfford={userCoins >= b.price}
                      onBuy={() => {
                        if (requireLogin()) return;
                        setConfirmItem({
                          item: { id: b.id, name: b.name, description: b.tagline, type: "frame", rarity: "legendary", price: b.price, Icon: b.Icon, iconWeight: "fill", iconColor: b.iconColor },
                          quantity: 1,
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ══════════ PREMIUM STORE ══════════ */}
        {isPremium && (
          <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            {/* Coming soon banner */}
            <div className="shop-banner text-center mb-8 py-4 px-6 rounded-2xl mx-auto max-w-lg"
              style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(124,58,237,0.04))", border: "1px solid rgba(168,85,247,0.15)" }}>
              <p className="text-purple-300 text-sm font-semibold mb-1">Premium store launching soon. Stay tuned.</p>
              <p className="text-purple-400/40 text-xs">Exclusive items purchasable with real money via Stripe</p>
            </div>

            {/* Premium tabs */}
            {/* Premium tabs */}
            <div className="flex items-center justify-center gap-1 sm:gap-2 mb-8">
              {([
                { key: "themes" as PremiumTab, label: "Themes", Icon: Palette, iconWeight: "regular" as IconProps["weight"] },
                { key: "frames" as PremiumTab, label: "Frames", Icon: ImageIcon, iconWeight: "regular" as IconProps["weight"] },
                { key: "name_colors" as PremiumTab, label: "Name Colors", Icon: Rainbow, iconWeight: "fill" as IconProps["weight"] },
                { key: "banners" as PremiumTab, label: "Banners", Icon: FlagBanner, iconWeight: "fill" as IconProps["weight"] },
              ]).map((t) => {
                const TabIcon = t.Icon;
                return (
                  <button key={t.key} onClick={() => setPremiumTab(t.key)}
                    className={`flex items-center gap-1.5 px-3 sm:px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200
                      ${premiumTab === t.key ? "bg-purple-500/15 text-purple-300 border border-purple-500/30" : "text-cream/60 hover:text-cream hover:bg-white/5 border border-transparent"}`}>
                    <TabIcon size={16} weight={t.iconWeight} color="currentColor" aria-hidden="true" />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Themes tab */}
            {premiumTab === "themes" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <div className="rounded-2xl overflow-hidden border border-purple-500/20 transition-all duration-300 hover:-translate-y-1 h-full flex flex-col"
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
                        <p className="text-purple-400/60 text-xs">Wild and golden. Warm light theme.</p>
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        Epic
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-2 gap-6">
                      <span className="font-bebas text-xl text-purple-300 flex-shrink-0">$2.99</span>
                      <button disabled className="relative flex-shrink-0 px-4 py-2 rounded-lg text-xs font-bold border border-purple-500/30 bg-purple-500/10 text-purple-400/60 cursor-not-allowed overflow-hidden">
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
        )}

        {/* ══════════ COIN STORE ══════════ */}
        {!isPremium && (
          <>
            {/* ── Tabs ── */}
            <div className={`flex items-center justify-center gap-1 sm:gap-2 mb-8 transition-all duration-700 delay-100 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
              {TABS.map((t) => {
                const TabIcon = t.Icon;
                return (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 px-3 sm:px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200
                      ${tab === t.key ? "bg-electric/15 text-electric border border-electric/30" : "text-cream/60 hover:text-cream hover:bg-white/5 border border-transparent"}`}>
                    <TabIcon size={16} weight={t.iconWeight} color="currentColor" aria-hidden="true" />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* FEATURED */}
            {tab === "featured" && (
              <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
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
                      <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} equipped={isEquipped(item.id)} canAfford={userCoins >= item.price}
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
                          <span className="font-bebas text-base text-gold">200 to 400</span>
                        </div>
                        <a href="#avatar-auras" className="px-3 py-1.5 rounded-lg text-xs font-bold border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-all">Browse</a>
                      </div>
                    </div>
                  </div>

                  {/* Aura sub-grid */}
                  <div id="avatar-auras" className="mt-6">
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45 mb-3">Avatar Auras &middot; pick your vibe</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shop-grid-stagger">
                      {AVATAR_AURAS.map((item) => (
                        <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} equipped={isEquipped(item.id)} canAfford={userCoins >= item.price}
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
            )}

            {/* COSMETICS */}
            {tab === "cosmetics" && (
              <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                {/* ── EXCLUSIVE: Founder badges (top of cosmetics tab) ── */}
                {FOUNDER_BADGES.some((b) => {
                  const r = founderCaps[b.id];
                  return r === undefined || r > 0 || cosmeticsOwned.some((c) => c.id === b.id);
                }) && (
                  <section className="mb-10" aria-labelledby="founder-badges-heading">
                    <div className="shop-banner flex items-center justify-between mb-5 px-4 py-3 rounded-xl"
                      style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.10), rgba(168,85,247,0.06))", border: "1px solid rgba(255,215,0,0.30)" }}>
                      <div className="flex items-center gap-2">
                        <Crown size={20} weight="fill" color="#FFD700" aria-hidden="true" />
                        <h2 id="founder-badges-heading" className="font-bebas text-xl text-gold tracking-wider">EXCLUSIVE &middot; FOUNDER BADGES</h2>
                      </div>
                      <span className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.2em] hidden sm:block">
                        Capped supply &middot; once they're gone, they're gone
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {FOUNDER_BADGES.map((b) => {
                        const remaining = founderCaps[b.id] ?? null;
                        const owned = cosmeticsOwned.some((c) => c.id === b.id);
                        return (
                          <FounderBadgeCard
                            key={b.id}
                            item={b}
                            remaining={remaining}
                            owned={owned}
                            canAfford={userCoins >= b.price}
                            onBuy={() => {
                              if (requireLogin()) return;
                              // Founder badges reuse the standard ConfirmModal path.
                              setConfirmItem({
                                item: { id: b.id, name: b.name, description: b.tagline, type: "frame", rarity: "legendary", price: b.price, Icon: b.Icon, iconWeight: "fill", iconColor: b.iconColor },
                                quantity: 1,
                              });
                            }}
                          />
                        );
                      })}
                    </div>
                  </section>
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
                        canAfford={userCoins >= item.price}
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
                        canAfford={userCoins >= item.price}
                        onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }}
                        onEquip={() => { if (!requireLogin()) void handleEquip(item.id); }}
                      />
                    ))}
                  </div>
                </section>

                {/* ── PREMIUM (cash): real-money banners called out explicitly ── */}
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

                {/* ── Existing cosmetics sub-tabs (frames / name colors / banners) ── */}
                <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-hide">
                  {COSMETIC_SUBS.map((s) => (
                    <button key={s.key} onClick={() => setCosmeticSub(s.key)}
                      className={`px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-all ${cosmeticSub === s.key
                        ? "bg-electric/15 text-electric border border-electric/30"
                        : "text-cream/60 hover:text-cream border border-transparent hover:border-white/10"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 shop-grid-stagger">
                  {filteredCosmetics.map((item) => (
                    <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} canAfford={userCoins >= item.price}
                      onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }} />
                  ))}
                </div>
              </div>
            )}

            {/* BOOSTERS */}
            {tab === "boosters" && (
              <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                <div className="space-y-3 shop-grid-stagger">
                  {BOOSTER_ITEMS.map((item) => (
                    <BoosterCard key={item.id} item={item} quantityOwned={getQuantity(item.id)} canAfford={userCoins >= item.price}
                      onBuy={(qty) => { if (!requireLogin()) setConfirmItem({ item, quantity: qty }); }} />
                  ))}
                </div>
              </div>
            )}

            {/* INVENTORY */}
            {tab === "inventory" && (
              <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                {/* Themes — always show Interstellar as owned */}
                <div className="mb-8">
                  <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2">
                    <Palette size={20} weight="regular" color="currentColor" aria-hidden="true" /> Themes
                  </h3>
                  <div className="space-y-2">
                    <div className="relative rounded-xl border border-green-500/40 p-4 transition-all duration-300 flex items-center gap-4"
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
                    <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2">
                      <Crown size={20} weight="fill" color="#FFD700" aria-hidden="true" /> Identity &amp; Status
                    </h3>
                    <div className="space-y-2">
                      {cosmeticsOwned.map((c) => {
                        const isUsernameEffect = c.type === "username_effect";
                        const isFounder = c.source === "founder";
                        const isEarned = c.source === "earned";
                        const sourceLabel = isFounder ? "Founder" : isEarned ? "Earned" : "Purchased";
                        const sourceColor = isFounder ? "text-gold" : isEarned ? "text-electric" : "text-cream/60";
                        const sourceBg = isFounder ? "bg-gold/15 border-gold/30" : isEarned ? "bg-electric/10 border-electric/30" : "bg-white/5 border-white/10";
                        return (
                          <div key={c.id} className="relative rounded-xl border border-white/10 p-4 flex items-center gap-3"
                            style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))" }}>
                            <div className={`px-2 py-0.5 rounded-full border ${sourceBg} flex items-center gap-1 flex-shrink-0`}>
                              <span className={`text-[9px] uppercase tracking-wider font-bold ${sourceColor}`}>{sourceLabel}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bebas text-base text-cream tracking-wide truncate">{c.id}</p>
                              <p className="text-cream/50 text-[11px] capitalize">{c.type.replace(/_/g, " ")}</p>
                            </div>
                            {isUsernameEffect && (
                              <button
                                onClick={() => handleEquipUsernameEffect(c.id)}
                                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                  c.equipped
                                    ? "border border-green-500/30 text-green-400 hover:bg-green-500/10"
                                    : "border border-electric/30 text-electric hover:bg-electric/10"
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

                {ownedCosmetics.length === 0 && ownedBoosters.length === 0 && cosmeticsOwned.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-cream/25 text-sm">Purchase items from the shop to add them to your inventory</p>
                    <button onClick={() => setTab("featured")} className="mt-4 btn-outline px-6 py-2 rounded-xl text-sm">Browse Shop</button>
                  </div>
                ) : (
                  <>
                    {ownedCosmetics.length > 0 && (
                      <div className="mb-8">
                        <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2">
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
                        <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2">
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
            )}
          </>
        )}
      </div>
    </div>
  );
}
