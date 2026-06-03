"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCoins } from "@/lib/mockData";
import { cdnUrl } from "@/lib/cdn";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError, toastInfo } from "@/lib/toast";
import DailySpinHero from "@/components/Shop/DailySpinHero";
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
type ItemType = "frame" | "background" | "name_color" | "banner" | "booster";
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
const RARITY_COLORS: Record<Rarity, { border: string; glow: string; bg: string; text: string; badge: string }> = {
  common: { border: "border-gray-500/40", glow: "shop-glow-common", bg: "bg-gray-500/8", text: "text-gray-400", badge: "bg-gray-500/20 text-gray-300" },
  rare: { border: "border-blue-500/40", glow: "shop-glow-rare", bg: "bg-blue-500/8", text: "text-blue-400", badge: "bg-blue-500/20 text-blue-300" },
  epic: { border: "border-purple-500/40", glow: "shop-glow-epic", bg: "bg-purple-500/8", text: "text-purple-400", badge: "bg-purple-500/20 text-purple-300" },
  legendary: { border: "border-yellow-500/40", glow: "shop-glow-legendary", bg: "bg-yellow-500/8", text: "text-yellow-400", badge: "bg-yellow-500/20 text-yellow-300" },
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
  { id: "boost_brain_freeze", name: "Brain Freeze", description: "50/50 — eliminate two wrong answers once", type: "booster", rarity: "epic", price: 125, Icon: Snowflake, iconWeight: "regular", iconColor: "#7DD3FC", boosterEffect: "fifty_fifty", boosterValue: 1, boosterDuration: 1 },
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

// ── Helpers ──
function getWeeklyCountdown() {
  const now = new Date();
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  nextMonday.setHours(0, 0, 0, 0);
  const diff = nextMonday.getTime() - now.getTime();
  return { days: Math.floor(diff / 86400000), hours: Math.floor((diff % 86400000) / 3600000) };
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
      <div className="shop-card relative w-full max-w-sm rounded-2xl border border-electric/20 p-6 animate-slide-up"
        style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }} onClick={(e) => e.stopPropagation()}>
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
        {!canAfford && <p className="text-red-400 text-xs text-center mb-4 font-semibold">Not enough coins — you need {formatCoins(totalPrice - userCoins)} more</p>}
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
function FeaturedCard({ item, owned, onBuy }: { item: ShopItem; owned: boolean; onBuy: () => void }) {
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  return (
    <div className={`shop-card shop-tilt-card relative group rounded-2xl border ${r.border} ${r.glow} overflow-hidden shop-item-float h-full flex flex-col`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.9), rgba(6,12,24,0.95))", backdropFilter: "blur(20px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative p-6 sm:p-8 flex flex-col flex-1">
        <span className={`absolute top-4 right-4 text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full ${r.badge}`}>{item.rarity}</span>
        <div className="mb-4 shop-item-icon">
          <Icon size={72} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
        </div>
        <h3 className="shop-card-title font-bebas text-2xl sm:text-3xl text-cream tracking-wide mb-1">{item.name}</h3>
        <p className="shop-card-desc text-cream/60 text-sm mb-5 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-6">
          <div className="flex items-center gap-2 flex-shrink-0">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
            <span className="font-bebas text-2xl text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned ? (
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
function CosmeticCard({ item, owned, canAfford, onBuy }: { item: ShopItem; owned: boolean; canAfford: boolean; onBuy: () => void }) {
  const r = RARITY_COLORS[item.rarity];
  const Icon = item.Icon;
  return (
    <div className={`shop-card shop-tilt-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300 h-full flex flex-col`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))", backdropFilter: "blur(12px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-3">
          <div className="shop-item-icon">
            <Icon size={40} weight={item.iconWeight ?? "fill"} color={item.iconColor ?? "currentColor"} aria-hidden="true" />
          </div>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <h4 className="shop-card-title font-bebas text-lg text-cream tracking-wide mb-0.5">{item.name}</h4>
        <p className="shop-card-desc text-cream/55 text-xs mb-4 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-6">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned ? (
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
    <div className={`shop-card shop-tilt-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))", backdropFilter: "blur(12px)" }}>
      <div className="relative p-4 flex items-center gap-4">
        <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${item.rarity === "common" ? "rgba(156,163,175,0.1)" : item.rarity === "rare" ? "rgba(59,130,246,0.1)" : item.rarity === "epic" ? "rgba(168,85,247,0.1)" : "rgba(255,215,0,0.1)"}, transparent)` }}>
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
    <div className={`shop-card relative rounded-xl border ${owned.equipped ? "border-green-500/40" : r.border} p-4 transition-all duration-300`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))" }}>
      {owned.equipped && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-green-500/20 border border-green-500/30 rounded-full px-2 py-0.5">
          <span className="text-green-400 text-[10px] font-bold uppercase tracking-wider">Equipped</span>
        </div>
      )}
      <div className="flex items-center gap-3">
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
    <div className={`shop-card shop-tilt-card premium-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300 h-full flex flex-col`}
      style={{ background: "linear-gradient(135deg, rgba(20,8,40,0.9), rgba(10,6,30,0.95))", backdropFilter: "blur(12px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border-premium" />}
      {item.rarity === "epic" && <div className="shop-epic-border-premium" />}
      <div className="relative p-5 flex flex-col flex-1">
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
          <button disabled className="relative flex-shrink-0 px-4 py-2 rounded-lg text-xs font-bold border border-purple-500/30 bg-purple-500/10 text-purple-400/60 cursor-not-allowed overflow-hidden">
            <span className="premium-coming-soon-pulse">Coming Soon</span>
          </button>
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
        toastError(res.error || "Couldn't open checkout. Try again.");
        setPending(null);
        return;
      }
      window.location.href = res.data.url;
    } catch (e) {
      toastError((e as Error).message || "Couldn't open checkout. Try again.");
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
              className="shop-card relative rounded-2xl overflow-hidden backdrop-blur-xl flex flex-col p-5"
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

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
        <p className="font-bebas text-2xl text-electric tracking-widest">LOADING...</p>
      </div>
    </div>
  );

  const userCoins = stats?.coins ?? user?.coins ?? 0;
  const countdown = getWeeklyCountdown();
  const ownedIds = new Set(inventory.map((i) => i.itemId));
  const getOwned = (id: string) => inventory.find((i) => i.itemId === id);
  const getQuantity = (id: string) => getOwned(id)?.quantity ?? 0;
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

  const ownedCosmetics = inventory.filter((o) => { const item = [...COSMETIC_ITEMS, ...FEATURED_ITEMS, ...NEW_SKUS, ...AVATAR_AURAS].find((i) => i.id === o.itemId); return item && item.type !== "booster"; });
  const ownedBoosters = inventory.filter((o) => { const item = [...BOOSTER_ITEMS, ...FEATURED_ITEMS, ...NEW_SKUS].find((i) => i.id === o.itemId); return item && item.type === "booster"; });
  const allItems = [...COSMETIC_ITEMS, ...BOOSTER_ITEMS, ...FEATURED_ITEMS, ...NEW_SKUS, ...AVATAR_AURAS];
  const findItem = (id: string) => allItems.find((i) => i.id === id);

  const isPremium = storeMode === "premium";

  return (
    <div className={`min-h-screen pt-16 pb-24 md:pb-12 transition-colors duration-500 ${isPremium ? "premium-store-bg" : ""}`}>
      {showBurst && <PurchaseBurst onDone={() => setShowBurst(false)} />}
      {confirmItem && <ConfirmModal item={confirmItem.item} quantity={confirmItem.quantity} onConfirm={handlePurchase} onCancel={() => setConfirmItem(null)} userCoins={userCoins} />}

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ── Header ── */}
        <div className={`text-center mb-6 transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          <div className="flex items-center justify-center gap-3 mb-2">
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
          <p className={`text-sm font-semibold tracking-widest uppercase ${isPremium ? "text-purple-400/60" : "text-cream/60"}`}>
            {isPremium ? "Premium Collection" : "Premium Item Shop"}
          </p>

          {/* Coin balance (coin store) / info (premium) */}
          <div className={`inline-flex items-center gap-2 mt-4 px-5 py-2 rounded-full transition-all duration-300 ${isPremium
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
                <span className="font-bebas text-3xl text-gold tracking-wider">{formatCoins(userCoins)}</span>
                <span className="text-cream/55 text-xs ml-1">coins</span>
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

        {/* ══════════ PREMIUM STORE ══════════ */}
        {isPremium && (
          <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            {/* Coming soon banner */}
            <div className="shop-banner text-center mb-8 py-4 px-6 rounded-2xl mx-auto max-w-lg"
              style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(124,58,237,0.04))", border: "1px solid rgba(168,85,247,0.15)" }}>
              <p className="text-purple-300 text-sm font-semibold mb-1">Premium store launching soon — stay tuned</p>
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
                        <p className="text-purple-400/60 text-xs">Wild & golden — warm light theme</p>
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
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {NEW_SKUS.map((item) => (
                      <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} canAfford={userCoins >= item.price}
                        onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }} />
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
                          <span className="font-bebas text-base text-gold">200&ndash;400</span>
                        </div>
                        <a href="#avatar-auras" className="px-3 py-1.5 rounded-lg text-xs font-bold border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-all">Browse</a>
                      </div>
                    </div>
                  </div>

                  {/* Aura sub-grid */}
                  <div id="avatar-auras" className="mt-6">
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45 mb-3">Avatar Auras &middot; pick your vibe</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                      {AVATAR_AURAS.map((item) => (
                        <CosmeticCard key={item.id} item={item} owned={ownedIds.has(item.id)} canAfford={userCoins >= item.price}
                          onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }} />
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
                  {FEATURED_ITEMS.map((item) => (
                    <FeaturedCard key={item.id} item={item} owned={ownedIds.has(item.id)}
                      onBuy={() => { if (!requireLogin()) setConfirmItem({ item, quantity: 1 }); }} />
                  ))}
                </div>
              </div>
            )}

            {/* COSMETICS */}
            {tab === "cosmetics" && (
              <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
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
                <div className="space-y-3">
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

                {ownedCosmetics.length === 0 && ownedBoosters.length === 0 ? (
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
