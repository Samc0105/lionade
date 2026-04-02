"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { useRouter } from "next/navigation";
import { formatCoins } from "@/lib/mockData";

// ── Types ──
type Rarity = "common" | "rare" | "epic" | "legendary";
type ItemType = "frame" | "background" | "name_color" | "banner" | "booster";
type BoosterEffect = "coin_multiplier" | "xp_multiplier" | "extra_time" | "auto_correct" | "fifty_fifty" | "score_boost" | "streak_shield";
type Tab = "featured" | "themes" | "cosmetics" | "boosters" | "inventory";
type CosmeticSub = "frames" | "backgrounds" | "name_colors" | "banners";
type StoreMode = "coins" | "premium";

interface ShopItem {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  rarity: Rarity;
  price: number;
  icon: string;
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
  icon: string;
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
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 500, icon: "🦁" },
  { id: "bg_nebula", name: "Nebula Background", description: "Swirling cosmic nebula backdrop", type: "background", rarity: "epic", price: 300, icon: "🌌" },
  { id: "boost_coin_rush", name: "Coin Rush", description: "2x coins for your next quiz", type: "booster", rarity: "rare", price: 75, icon: "💰", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis name effect", type: "name_color", rarity: "legendary", price: 450, icon: "🌈" },
];

const COSMETIC_ITEMS: ShopItem[] = [
  { id: "frame_basic_blue", name: "Electric Blue", description: "Clean electric blue border", type: "frame", rarity: "common", price: 25, icon: "🔵" },
  { id: "frame_fire", name: "Inferno Ring", description: "Burning ring of fire around your avatar", type: "frame", rarity: "rare", price: 100, icon: "🔥" },
  { id: "frame_crystal", name: "Crystal Prism", description: "Refracting crystal light frame", type: "frame", rarity: "epic", price: 250, icon: "💎" },
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 500, icon: "🦁" },
  { id: "bg_midnight", name: "Midnight Sky", description: "Deep midnight gradient", type: "background", rarity: "common", price: 30, icon: "🌙" },
  { id: "bg_ocean", name: "Deep Ocean", description: "Abyssal ocean depths", type: "background", rarity: "rare", price: 80, icon: "🌊" },
  { id: "bg_nebula", name: "Nebula Background", description: "Swirling cosmic nebula backdrop", type: "background", rarity: "epic", price: 300, icon: "🌌" },
  { id: "bg_supernova", name: "Supernova Burst", description: "Exploding star in brilliant colors", type: "background", rarity: "legendary", price: 600, icon: "💥" },
  { id: "name_ice", name: "Ice Blue", description: "Frosty ice blue name", type: "name_color", rarity: "common", price: 20, icon: "🧊" },
  { id: "name_emerald", name: "Emerald Green", description: "Rich emerald name color", type: "name_color", rarity: "rare", price: 90, icon: "💚" },
  { id: "name_amethyst", name: "Amethyst Purple", description: "Deep amethyst glow", type: "name_color", rarity: "epic", price: 200, icon: "💜" },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis effect", type: "name_color", rarity: "legendary", price: 450, icon: "🌈" },
  { id: "banner_starter", name: "Starter Banner", description: "Simple gradient banner", type: "banner", rarity: "common", price: 15, icon: "🏳️" },
  { id: "banner_warrior", name: "Warrior Banner", description: "Battle-worn warrior flag", type: "banner", rarity: "rare", price: 120, icon: "⚔️" },
  { id: "banner_galaxy", name: "Galaxy Banner", description: "Full galaxy panorama", type: "banner", rarity: "epic", price: 280, icon: "✨" },
  { id: "banner_legend", name: "Legend Banner", description: "Only for the truly legendary", type: "banner", rarity: "legendary", price: 750, icon: "👑" },
];

const BOOSTER_ITEMS: ShopItem[] = [
  { id: "boost_coin_rush", name: "Coin Rush", description: "2x coins earned on your next quiz", type: "booster", rarity: "rare", price: 75, icon: "💰", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_xp_surge", name: "XP Surge", description: "2x XP earned on your next quiz", type: "booster", rarity: "rare", price: 75, icon: "⚡", boosterEffect: "xp_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_streak_shield", name: "Streak Shield", description: "Protects your streak for one missed day", type: "booster", rarity: "epic", price: 150, icon: "🛡️", boosterEffect: "streak_shield", boosterValue: 0, boosterDuration: 1 },
  { id: "boost_double_down", name: "Double Down", description: "Double coins AND XP on next quiz", type: "booster", rarity: "epic", price: 200, icon: "🎲", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_lucky_start", name: "Lucky Start", description: "First question auto-correct", type: "booster", rarity: "rare", price: 100, icon: "🍀", boosterEffect: "auto_correct", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_time_warp", name: "Time Warp", description: "+10 seconds per question", type: "booster", rarity: "common", price: 40, icon: "⏰", boosterEffect: "extra_time", boosterValue: 10, boosterDuration: 1 },
  { id: "boost_brain_freeze", name: "Brain Freeze", description: "50/50 — eliminate two wrong answers once", type: "booster", rarity: "epic", price: 125, icon: "🧊", boosterEffect: "fifty_fifty", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_score_boost", name: "Score Boost", description: "+1 added to your final score", type: "booster", rarity: "common", price: 50, icon: "📈", boosterEffect: "score_boost", boosterValue: 1, boosterDuration: 1 },
];

// ══════════════════════════════════════════
// ── Premium Store Items ──
// ══════════════════════════════════════════

const PREMIUM_ITEMS: PremiumItem[] = [
  { id: "prem_frame_diamond", name: "Diamond Crown Frame", description: "An ultra-rare diamond-encrusted frame that radiates prestige", type: "frame", rarity: "legendary", priceUSD: 4.99, icon: "💠" },
  { id: "prem_frame_neon", name: "Neon Pulse Frame", description: "Reactive neon border that pulses with energy", type: "frame", rarity: "epic", priceUSD: 2.99, icon: "💫" },
  { id: "prem_bg_aurora", name: "Northern Lights", description: "Animated aurora borealis background", type: "background", rarity: "legendary", priceUSD: 3.99, icon: "🌌" },
  { id: "prem_bg_lava", name: "Molten Core", description: "Living lava flow background", type: "background", rarity: "epic", priceUSD: 2.49, icon: "🌋" },
  { id: "prem_name_holo", name: "Holographic Name", description: "Holographic rainbow shift name effect", type: "name_color", rarity: "legendary", priceUSD: 1.99, icon: "🔮" },
  { id: "prem_name_gold", name: "Solid Gold Name", description: "Pure gold name with metallic sheen", type: "name_color", rarity: "epic", priceUSD: 1.49, icon: "🥇" },
  { id: "prem_banner_phoenix", name: "Phoenix Rising", description: "Animated phoenix banner with particle trail", type: "banner", rarity: "legendary", priceUSD: 4.99, icon: "🔱" },
  { id: "prem_banner_void", name: "Void Walker", description: "Dark energy void banner with lightning", type: "banner", rarity: "epic", priceUSD: 3.49, icon: "🌀" },
  { id: "prem_frame_starfield", name: "Starfield Frame", description: "Animated stars orbiting your avatar", type: "frame", rarity: "rare", priceUSD: 1.99, icon: "⭐" },
  { id: "prem_bg_cyberpunk", name: "Cyberpunk City", description: "Neon-drenched cyber cityscape", type: "background", rarity: "rare", priceUSD: 1.99, icon: "🏙️" },
  { id: "prem_banner_lightning", name: "Thunder Strike", description: "Crackling lightning bolt banner", type: "banner", rarity: "rare", priceUSD: 2.49, icon: "⚡" },
  { id: "prem_name_fire", name: "Flame Name", description: "Burning flame text effect", type: "name_color", rarity: "rare", priceUSD: 0.99, icon: "🔥" },
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
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="shop-card relative w-full max-w-sm rounded-2xl border border-electric/20 p-6 animate-slide-up"
        style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }} onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">{item.icon}</div>
          <h3 className="font-bebas text-2xl text-cream tracking-wide">{item.name}</h3>
          <span className={`inline-block mt-1 text-[10px] uppercase tracking-widest font-bold px-2.5 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <div className="flex items-center justify-center gap-2 mb-6 py-3 rounded-xl" style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}>
          <img src="/F.png" alt="Fangs" className="w-6 h-6 object-contain" />
          <span className="font-bebas text-3xl text-gold">{formatCoins(totalPrice)}</span>
          {quantity > 1 && <span className="text-cream/40 text-sm ml-1">(x{quantity})</span>}
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
  return (
    <div className={`shop-card shop-tilt-card relative group rounded-2xl border ${r.border} ${r.glow} overflow-hidden shop-item-float h-full flex flex-col`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.9), rgba(6,12,24,0.95))", backdropFilter: "blur(20px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative p-6 sm:p-8 flex flex-col flex-1">
        <span className={`absolute top-4 right-4 text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full ${r.badge}`}>{item.rarity}</span>
        <div className="text-6xl sm:text-7xl mb-4 shop-item-icon">{item.icon}</div>
        <h3 className="shop-card-title font-bebas text-2xl sm:text-3xl text-cream tracking-wide mb-1">{item.name}</h3>
        <p className="shop-card-desc text-cream/40 text-sm mb-5 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-6">
          <div className="flex items-center gap-2 flex-shrink-0">
            <img src="/F.png" alt="Fangs" className="w-6 h-6 object-contain" />
            <span className="font-bebas text-2xl text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned ? (
            <span className="flex items-center gap-1.5 text-green-400 text-sm font-bold"><span>✓</span> Owned</span>
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
  return (
    <div className={`shop-card shop-tilt-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300 h-full flex flex-col`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))", backdropFilter: "blur(12px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-3">
          <div className="text-4xl shop-item-icon">{item.icon}</div>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <h4 className="shop-card-title font-bebas text-lg text-cream tracking-wide mb-0.5">{item.name}</h4>
        <p className="shop-card-desc text-cream/30 text-xs mb-4 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between mt-auto pt-2 gap-6">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <img src="/F.png" alt="Fangs" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold flex-shrink-0"><span>✓</span> Owned</span>
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
  const bulkPrice = Math.floor(item.price * 5 * 0.9);
  return (
    <div className={`shop-card shop-tilt-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))", backdropFilter: "blur(12px)" }}>
      <div className="relative p-4 flex items-center gap-4">
        <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center text-3xl"
          style={{ background: `linear-gradient(135deg, ${item.rarity === "common" ? "rgba(156,163,175,0.1)" : item.rarity === "rare" ? "rgba(59,130,246,0.1)" : item.rarity === "epic" ? "rgba(168,85,247,0.1)" : "rgba(255,215,0,0.1)"}, transparent)` }}>
          {item.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className="shop-card-title font-bebas text-lg text-cream tracking-wide">{item.name}</h4>
            <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
          </div>
          <p className="shop-card-desc text-cream/30 text-xs mb-3 leading-relaxed">{item.description}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => onBuy(1)} disabled={!canAfford}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford ? "gold-btn shop-btn-pulse" : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"}`}>
              <img src="/F.png" alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(item.price)} &middot; Buy x1
            </button>
            <button onClick={() => onBuy(5)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-electric/30 text-electric hover:bg-electric/10">
              <img src="/F.png" alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(bulkPrice)} &middot; Buy x5 <span className="text-green-400 text-[10px]">(save 10%)</span>
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
  return (
    <div className={`shop-card relative rounded-xl border ${owned.equipped ? "border-green-500/40" : r.border} p-4 transition-all duration-300`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))" }}>
      {owned.equipped && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-green-500/20 border border-green-500/30 rounded-full px-2 py-0.5">
          <span className="text-green-400 text-[10px] font-bold uppercase tracking-wider">Equipped</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="text-3xl">{item.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-bebas text-base text-cream tracking-wide">{item.name}</h4>
            <span className={`text-[8px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
          </div>
          {isBooster ? (
            <p className="text-cream/30 text-xs">Qty: {owned.quantity} remaining &middot; Use Before Quiz</p>
          ) : (
            <p className="text-cream/30 text-xs">{item.description}</p>
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
  return (
    <div className={`shop-card shop-tilt-card premium-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300 h-full flex flex-col`}
      style={{ background: "linear-gradient(135deg, rgba(20,8,40,0.9), rgba(10,6,30,0.95))", backdropFilter: "blur(12px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border-premium" />}
      {item.rarity === "epic" && <div className="shop-epic-border-premium" />}
      <div className="relative p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-3">
          <div className="text-5xl shop-item-icon premium-icon-glow">{item.icon}</div>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>{item.rarity}</span>
        </div>
        <h4 className="shop-card-title font-bebas text-xl text-cream tracking-wide mb-0.5">{item.name}</h4>
        <p className="shop-card-desc text-cream/30 text-xs mb-5 leading-relaxed">{item.description}</p>
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
// ── Main Shop Page ──
// ══════════════════════════════════════════════════
export default function ShopPage() {
  const { user, isLoading, refreshUser } = useAuth();
  const { stats } = useUserStats(user?.id);
  const router = useRouter();

  const [storeMode, setStoreMode] = useState<StoreMode>("coins");
  const [tab, setTab] = useState<Tab>("featured");
  const [cosmeticSub, setCosmeticSub] = useState<CosmeticSub>("frames");
  const [inventory, setInventory] = useState<OwnedItem[]>([]);
  const [confirmItem, setConfirmItem] = useState<{ item: ShopItem; quantity: number } | null>(null);
  const [showBurst, setShowBurst] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const loadInventory = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/shop/purchase?userId=${user.id}`);
      if (res.ok) { const data = await res.json(); if (data.inventory) setInventory(data.inventory); }
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

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
    try {
      const totalPrice = confirmItem.item.price * confirmItem.quantity;
      const finalPrice = confirmItem.quantity === 5 ? Math.floor(totalPrice * 0.9) : totalPrice;
      const res = await fetch("/api/shop/purchase", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, itemId: confirmItem.item.id, itemType: confirmItem.item.type, price: finalPrice, quantity: confirmItem.quantity, itemName: confirmItem.item.name, rarity: confirmItem.item.rarity }),
      });
      if (res.ok) { setShowBurst(true); await refreshUser(); await loadInventory(); }
    } catch { /* ignore */ }
    setPurchasing(false);
    setConfirmItem(null);
  };

  const handleEquip = async (itemId: string) => {
    if (!user) return;
    try {
      await fetch("/api/shop/equip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, itemId }) });
      await loadInventory();
    } catch { /* ignore */ }
  };

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "featured", label: "Featured", icon: "⭐" },
    { key: "themes", label: "Themes", icon: "🎨" },
    { key: "cosmetics", label: "Cosmetics", icon: "✨" },
    { key: "boosters", label: "Boosters", icon: "🚀" },
    { key: "inventory", label: "Inventory", icon: "🎒" },
  ];

  const COSMETIC_SUBS: { key: CosmeticSub; label: string }[] = [
    { key: "frames", label: "Frames" }, { key: "backgrounds", label: "Backgrounds" },
    { key: "name_colors", label: "Name Colors" }, { key: "banners", label: "Banners" },
  ];

  const cosmeticTypeMap: Record<CosmeticSub, ItemType> = { frames: "frame", backgrounds: "background", name_colors: "name_color", banners: "banner" };
  const filteredCosmetics = COSMETIC_ITEMS.filter((i) => i.type === cosmeticTypeMap[cosmeticSub]);

  const ownedCosmetics = inventory.filter((o) => { const item = [...COSMETIC_ITEMS, ...FEATURED_ITEMS].find((i) => i.id === o.itemId); return item && item.type !== "booster"; });
  const ownedBoosters = inventory.filter((o) => { const item = [...BOOSTER_ITEMS, ...FEATURED_ITEMS].find((i) => i.id === o.itemId); return item && item.type === "booster"; });
  const allItems = [...COSMETIC_ITEMS, ...BOOSTER_ITEMS, ...FEATURED_ITEMS];
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
            <span className="text-4xl sm:text-5xl">{isPremium ? "💎" : "🏛️"}</span>
            <h1 className={`font-bebas text-5xl sm:text-7xl tracking-wider ${isPremium ? "shop-title-glow-premium" : "shop-title-glow"}`}>
              THE LION&apos;S DEN
            </h1>
            <span className="text-4xl sm:text-5xl">{isPremium ? "✨" : "🐾"}</span>
          </div>
          <p className={`text-sm font-semibold tracking-widest uppercase ${isPremium ? "text-purple-400/60" : "text-cream/40"}`}>
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
                <span className="text-lg">💎</span>
                <span className="font-bebas text-2xl text-purple-300 tracking-wider">Premium</span>
              </>
            ) : (
              <>
                <img src="/F.png" alt="Fangs" className="w-8 h-8 object-contain" />
                <span className="font-bebas text-3xl text-gold tracking-wider">{formatCoins(userCoins)}</span>
                <span className="text-cream/30 text-xs ml-1">coins</span>
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
              className={`relative z-10 flex items-center gap-2 px-5 sm:px-7 py-2.5 rounded-full text-sm font-bold transition-all duration-200 ${!isPremium ? "text-gold" : "text-cream/40 hover:text-cream/60"}`}>
              <img src="/F.png" alt="Fangs" className="w-5 h-5 object-contain" /> Coin Store
            </button>
            <button onClick={() => setStoreMode("premium")}
              className={`relative z-10 flex items-center gap-2 px-5 sm:px-7 py-2.5 rounded-full text-sm font-bold transition-all duration-200 ${isPremium ? "text-purple-300" : "text-cream/40 hover:text-cream/60"}`}>
              <span>💎</span> Premium Store
            </button>
          </div>
        </div>

        {/* ══════════ PREMIUM STORE ══════════ */}
        {isPremium && (
          <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            {/* Coming soon banner */}
            <div className="shop-banner text-center mb-8 py-4 px-6 rounded-2xl mx-auto max-w-lg"
              style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(124,58,237,0.04))", border: "1px solid rgba(168,85,247,0.15)" }}>
              <p className="text-purple-300 text-sm font-semibold mb-1">Premium store launching soon — stay tuned</p>
              <p className="text-purple-400/40 text-xs">Exclusive items purchasable with real money via Stripe</p>
            </div>

            {/* Premium grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {PREMIUM_ITEMS.map((item) => (
                <PremiumCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* ══════════ COIN STORE ══════════ */}
        {!isPremium && (
          <>
            {/* ── Tabs ── */}
            <div className={`flex items-center justify-center gap-1 sm:gap-2 mb-8 transition-all duration-700 delay-100 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 sm:px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200
                    ${tab === t.key ? "bg-electric/15 text-electric border border-electric/30" : "text-cream/40 hover:text-cream hover:bg-white/5 border border-transparent"}`}>
                  <span>{t.icon}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>

            {/* THEMES */}
            {tab === "themes" && (
              <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                <div className="shop-banner flex items-center justify-between mb-6 px-4 py-3 rounded-xl"
                  style={{ background: "linear-gradient(90deg, rgba(245,158,11,0.06), rgba(255,215,0,0.06))", border: "1px solid rgba(245,158,11,0.15)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🎨</span>
                    <span className="font-bebas text-xl text-gold tracking-wider">THEMES</span>
                  </div>
                  <p className="text-cream/30 text-xs">Change the look of your entire app</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {/* Savanna Theme */}
                  <div className="rounded-2xl overflow-hidden border border-amber-500/20 transition-all duration-300 hover:-translate-y-1"
                    style={{ background: "var(--card-solid-bg)" }}>
                    {/* Preview */}
                    <div className="h-36 relative overflow-hidden">
                      <img src="/savannah.png" alt="Savanna theme preview" className="absolute inset-0 w-full h-full object-cover grayscale-[60%] brightness-75" />
                      {/* Dark overlay + lock */}
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-black/40 border border-white/10 flex items-center justify-center">
                          <span className="text-2xl">🔒</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-5">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-bebas text-xl text-cream tracking-wider">Savanna</p>
                          <p className="text-amber-400/60 text-xs">Wild & golden — warm light theme</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#a855f7" }}>
                          Epic
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-4">
                        <div className="flex items-center gap-1.5">
                          <img src="/F.png" alt="Fangs" className="w-5 h-5 object-contain" />
                          <span className="font-bebas text-xl text-gold tracking-wider">500</span>
                        </div>
                        <button disabled className="px-5 py-2 rounded-xl text-sm font-bold text-cream/30 border border-white/10 bg-white/5 cursor-not-allowed">
                          Coming Soon
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* FEATURED */}
            {tab === "featured" && (
              <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                <div className="shop-banner flex items-center justify-between mb-6 px-4 py-3 rounded-xl"
                  style={{ background: "linear-gradient(90deg, rgba(255,215,0,0.06), rgba(168,85,247,0.06))", border: "1px solid rgba(255,215,0,0.15)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🔥</span>
                    <span className="font-bebas text-xl text-gold tracking-wider">WEEKLY FEATURED</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-cream/40 text-xs font-mono">
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
                        : "text-cream/40 hover:text-cream border border-transparent hover:border-white/10"}`}>
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
                {ownedCosmetics.length === 0 && ownedBoosters.length === 0 ? (
                  <div className="text-center py-20">
                    <span className="text-6xl block mb-4">🛍️</span>
                    <p className="font-bebas text-2xl text-cream/40 tracking-wider">Your inventory is empty</p>
                    <p className="text-cream/25 text-sm mt-1">Purchase items from the shop to see them here</p>
                    <button onClick={() => setTab("featured")} className="mt-6 btn-outline px-6 py-2 rounded-xl text-sm">Browse Shop</button>
                  </div>
                ) : (
                  <>
                    {ownedCosmetics.length > 0 && (
                      <div className="mb-8">
                        <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2"><span>🎨</span> Cosmetics</h3>
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
                        <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2"><span>🚀</span> Boosters</h3>
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
