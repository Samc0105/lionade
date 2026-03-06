"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { formatCoins } from "@/lib/mockData";

// ── Types ──
type Rarity = "common" | "rare" | "epic" | "legendary";
type ItemType = "frame" | "background" | "name_color" | "banner" | "booster";
type BoosterEffect = "coin_multiplier" | "xp_multiplier" | "extra_time" | "auto_correct" | "fifty_fifty" | "score_boost";
type Tab = "featured" | "cosmetics" | "boosters" | "inventory";
type CosmeticSub = "frames" | "backgrounds" | "name_colors" | "banners";

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

interface OwnedItem {
  itemId: string;
  quantity: number;
  equipped: boolean;
  acquiredAt: string;
}

// ── Shop Data ──
const RARITY_COLORS: Record<Rarity, { border: string; glow: string; bg: string; text: string; badge: string }> = {
  common:    { border: "border-gray-500/40",    glow: "shop-glow-common",    bg: "bg-gray-500/8",   text: "text-gray-400",   badge: "bg-gray-500/20 text-gray-300" },
  rare:      { border: "border-blue-500/40",    glow: "shop-glow-rare",      bg: "bg-blue-500/8",   text: "text-blue-400",   badge: "bg-blue-500/20 text-blue-300" },
  epic:      { border: "border-purple-500/40",  glow: "shop-glow-epic",      bg: "bg-purple-500/8", text: "text-purple-400", badge: "bg-purple-500/20 text-purple-300" },
  legendary: { border: "border-yellow-500/40",  glow: "shop-glow-legendary", bg: "bg-yellow-500/8", text: "text-yellow-400", badge: "bg-yellow-500/20 text-yellow-300" },
};

const FEATURED_ITEMS: ShopItem[] = [
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 500, icon: "🦁" },
  { id: "bg_nebula", name: "Nebula Background", description: "Swirling cosmic nebula backdrop", type: "background", rarity: "epic", price: 300, icon: "🌌" },
  { id: "boost_coin_rush", name: "Coin Rush", description: "2x coins for your next quiz", type: "booster", rarity: "rare", price: 75, icon: "🪙", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis name effect", type: "name_color", rarity: "legendary", price: 450, icon: "🌈" },
];

const COSMETIC_ITEMS: ShopItem[] = [
  // Frames
  { id: "frame_basic_blue", name: "Electric Blue", description: "Clean electric blue border", type: "frame", rarity: "common", price: 25, icon: "🔵" },
  { id: "frame_fire", name: "Inferno Ring", description: "Burning ring of fire around your avatar", type: "frame", rarity: "rare", price: 100, icon: "🔥" },
  { id: "frame_crystal", name: "Crystal Prism", description: "Refracting crystal light frame", type: "frame", rarity: "epic", price: 250, icon: "💎" },
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 500, icon: "🦁" },
  // Backgrounds
  { id: "bg_midnight", name: "Midnight Sky", description: "Deep midnight gradient", type: "background", rarity: "common", price: 30, icon: "🌙" },
  { id: "bg_ocean", name: "Deep Ocean", description: "Abyssal ocean depths", type: "background", rarity: "rare", price: 80, icon: "🌊" },
  { id: "bg_nebula", name: "Nebula Background", description: "Swirling cosmic nebula backdrop", type: "background", rarity: "epic", price: 300, icon: "🌌" },
  { id: "bg_supernova", name: "Supernova Burst", description: "Exploding star in brilliant colors", type: "background", rarity: "legendary", price: 600, icon: "💥" },
  // Name Colors
  { id: "name_ice", name: "Ice Blue", description: "Frosty ice blue name", type: "name_color", rarity: "common", price: 20, icon: "🧊" },
  { id: "name_emerald", name: "Emerald Green", description: "Rich emerald name color", type: "name_color", rarity: "rare", price: 90, icon: "💚" },
  { id: "name_amethyst", name: "Amethyst Purple", description: "Deep amethyst glow", type: "name_color", rarity: "epic", price: 200, icon: "💜" },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis effect", type: "name_color", rarity: "legendary", price: 450, icon: "🌈" },
  // Banners
  { id: "banner_starter", name: "Starter Banner", description: "Simple gradient banner", type: "banner", rarity: "common", price: 15, icon: "🏳️" },
  { id: "banner_warrior", name: "Warrior Banner", description: "Battle-worn warrior flag", type: "banner", rarity: "rare", price: 120, icon: "⚔️" },
  { id: "banner_galaxy", name: "Galaxy Banner", description: "Full galaxy panorama", type: "banner", rarity: "epic", price: 280, icon: "✨" },
  { id: "banner_legend", name: "Legend Banner", description: "Only for the truly legendary", type: "banner", rarity: "legendary", price: 750, icon: "👑" },
];

const BOOSTER_ITEMS: ShopItem[] = [
  { id: "boost_coin_rush", name: "Coin Rush", description: "2x coins earned on your next quiz", type: "booster", rarity: "rare", price: 75, icon: "🪙", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_xp_surge", name: "XP Surge", description: "2x XP earned on your next quiz", type: "booster", rarity: "rare", price: 75, icon: "⚡", boosterEffect: "xp_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_streak_shield", name: "Streak Shield", description: "Protects your streak for one missed day", type: "booster", rarity: "epic", price: 150, icon: "🛡️", boosterEffect: "score_boost", boosterValue: 0, boosterDuration: 1 },
  { id: "boost_double_down", name: "Double Down", description: "Double coins AND XP on next quiz", type: "booster", rarity: "epic", price: 200, icon: "🎲", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_lucky_start", name: "Lucky Start", description: "First question auto-correct", type: "booster", rarity: "rare", price: 100, icon: "🍀", boosterEffect: "auto_correct", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_time_warp", name: "Time Warp", description: "+10 seconds per question", type: "booster", rarity: "common", price: 40, icon: "⏰", boosterEffect: "extra_time", boosterValue: 10, boosterDuration: 1 },
  { id: "boost_brain_freeze", name: "Brain Freeze", description: "50/50 — eliminate two wrong answers once", type: "booster", rarity: "epic", price: 125, icon: "🧊", boosterEffect: "fifty_fifty", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_score_boost", name: "Score Boost", description: "+1 added to your final score", type: "booster", rarity: "common", price: 50, icon: "📈", boosterEffect: "score_boost", boosterValue: 1, boosterDuration: 1 },
];

// ── Weekly countdown ──
function getWeeklyCountdown() {
  const now = new Date();
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  nextMonday.setHours(0, 0, 0, 0);
  const diff = nextMonday.getTime() - now.getTime();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  return { days, hours };
}

// ── Purchase particle burst ──
function PurchaseBurst({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1200);
    return () => clearTimeout(t);
  }, [onDone]);

  const particles = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * 360;
    const dist = 40 + Math.random() * 60;
    return {
      id: i,
      dx: Math.cos((angle * Math.PI) / 180) * dist,
      dy: Math.sin((angle * Math.PI) / 180) * dist,
      delay: Math.random() * 0.15,
      size: 3 + Math.random() * 4,
    };
  });

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full coin-burst-particle"
          style={{
            width: p.size,
            height: p.size,
            background: "#FFD700",
            boxShadow: "0 0 6px #FFD700, 0 0 12px rgba(255,215,0,0.5)",
            // @ts-expect-error CSS custom properties
            "--burst-x": `${p.dx}px`,
            "--burst-y": `${p.dy}px`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Confirm Modal ──
function ConfirmModal({ item, quantity, onConfirm, onCancel, userCoins }: {
  item: ShopItem; quantity: number; onConfirm: () => void; onCancel: () => void; userCoins: number;
}) {
  const totalPrice = item.price * quantity;
  const canAfford = userCoins >= totalPrice;
  const r = RARITY_COLORS[item.rarity];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-2xl border border-electric/20 p-6 animate-slide-up"
        style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">{item.icon}</div>
          <h3 className="font-bebas text-2xl text-cream tracking-wide">{item.name}</h3>
          <span className={`inline-block mt-1 text-[10px] uppercase tracking-widest font-bold px-2.5 py-0.5 rounded-full ${r.badge}`}>
            {item.rarity}
          </span>
        </div>
        <div className="flex items-center justify-center gap-2 mb-6 py-3 rounded-xl" style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}>
          <span className="text-lg">🪙</span>
          <span className="font-bebas text-3xl text-gold">{formatCoins(totalPrice)}</span>
          {quantity > 1 && <span className="text-cream/40 text-sm ml-1">(x{quantity})</span>}
        </div>
        {!canAfford && (
          <p className="text-red-400 text-xs text-center mb-4 font-semibold">Not enough coins — you need {formatCoins(totalPrice - userCoins)} more</p>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-electric/20 text-cream/60 text-sm font-bold hover:bg-white/5 transition-all">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!canAfford}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${canAfford
              ? "gold-btn shop-btn-pulse cursor-pointer"
              : "bg-gray-600/30 text-gray-500 cursor-not-allowed border border-gray-600/20"
            }`}>
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
    <div className={`shop-tilt-card relative group rounded-2xl border ${r.border} ${r.glow} overflow-hidden shop-item-float`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.9), rgba(6,12,24,0.95))", backdropFilter: "blur(20px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative p-6 sm:p-8">
        <span className={`absolute top-4 right-4 text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full ${r.badge}`}>
          {item.rarity}
        </span>
        <div className="text-6xl sm:text-7xl mb-4 shop-item-icon">{item.icon}</div>
        <h3 className="font-bebas text-2xl sm:text-3xl text-cream tracking-wide mb-1">{item.name}</h3>
        <p className="text-cream/40 text-sm mb-5 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-base">🪙</span>
            <span className="font-bebas text-2xl text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned ? (
            <span className="flex items-center gap-1.5 text-green-400 text-sm font-bold"><span>✓</span> Owned</span>
          ) : (
            <button onClick={onBuy} className="gold-btn shop-btn-pulse px-5 py-2 rounded-xl text-sm font-bold">
              Buy Now
            </button>
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
    <div className={`shop-tilt-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300 hover:${r.glow}`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))", backdropFilter: "blur(12px)" }}>
      {item.rarity === "legendary" && <div className="shop-legendary-border" />}
      <div className="relative p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="text-4xl shop-item-icon">{item.icon}</div>
          <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>
            {item.rarity}
          </span>
        </div>
        <h4 className="font-bebas text-lg text-cream tracking-wide mb-0.5">{item.name}</h4>
        <p className="text-cream/30 text-xs mb-4 leading-relaxed">{item.description}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-sm">🪙</span>
            <span className="font-bebas text-lg text-gold">{formatCoins(item.price)}</span>
          </div>
          {owned ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-bold"><span>✓</span> Owned</span>
          ) : (
            <button onClick={onBuy} disabled={!canAfford}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford
                ? "gold-btn shop-btn-pulse"
                : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"
              }`}>
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
  const canAffordBulk = canAfford && (quantityOwned === 0 || true); // always show bulk

  return (
    <div className={`shop-tilt-card relative group rounded-xl border ${r.border} overflow-hidden transition-all duration-300`}
      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85), rgba(6,12,24,0.9))", backdropFilter: "blur(12px)" }}>
      <div className="relative p-4 flex items-center gap-4">
        {/* Icon */}
        <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center text-3xl"
          style={{ background: `linear-gradient(135deg, ${r.text === "text-gray-400" ? "rgba(156,163,175,0.1)" : r.text === "text-blue-400" ? "rgba(59,130,246,0.1)" : r.text === "text-purple-400" ? "rgba(168,85,247,0.1)" : "rgba(255,215,0,0.1)"}, transparent)` }}>
          {item.icon}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className="font-bebas text-lg text-cream tracking-wide">{item.name}</h4>
            <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${r.badge}`}>
              {item.rarity}
            </span>
          </div>
          <p className="text-cream/30 text-xs mb-3 leading-relaxed">{item.description}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => onBuy(1)} disabled={!canAfford}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canAfford
                ? "gold-btn shop-btn-pulse"
                : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"
              }`}>
              <span>🪙</span> {formatCoins(item.price)} &middot; Buy x1
            </button>
            <button onClick={() => onBuy(5)} disabled={!canAffordBulk}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canAffordBulk
                ? "border border-electric/30 text-electric hover:bg-electric/10"
                : "bg-gray-600/20 text-gray-500 cursor-not-allowed border border-gray-600/20"
              }`}>
              <span>🪙</span> {formatCoins(bulkPrice)} &middot; Buy x5 <span className="text-green-400 text-[10px]">(save 10%)</span>
            </button>
          </div>
        </div>

        {/* Quantity owned */}
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
    <div className={`relative rounded-xl border ${owned.equipped ? "border-green-500/40" : r.border} p-4 transition-all duration-300`}
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
            <span className={`text-[8px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full ${r.badge}`}>
              {item.rarity}
            </span>
          </div>
          {isBooster ? (
            <p className="text-cream/30 text-xs">Qty: {owned.quantity} remaining &middot; Use Before Quiz</p>
          ) : (
            <p className="text-cream/30 text-xs">{item.description}</p>
          )}
        </div>
        {!isBooster && (
          <button onClick={onEquip}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${owned.equipped
              ? "border border-green-500/30 text-green-400 hover:bg-green-500/10"
              : "border border-electric/30 text-electric hover:bg-electric/10"
            }`}>
            {owned.equipped ? "Unequip" : "Equip"}
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════
// ── Main Shop Page ──
// ══════════════════════════════════════════════════
export default function ShopPage() {
  const { user, isLoading, refreshUser } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("featured");
  const [cosmeticSub, setCosmeticSub] = useState<CosmeticSub>("frames");
  const [inventory, setInventory] = useState<OwnedItem[]>([]);
  const [confirmItem, setConfirmItem] = useState<{ item: ShopItem; quantity: number } | null>(null);
  const [showBurst, setShowBurst] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  // Load inventory
  const loadInventory = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/shop/purchase?userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.inventory) setInventory(data.inventory);
      }
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  if (isLoading || !user) return null;

  const countdown = getWeeklyCountdown();
  const ownedIds = new Set(inventory.map((i) => i.itemId));
  const getOwned = (id: string) => inventory.find((i) => i.itemId === id);
  const getQuantity = (id: string) => getOwned(id)?.quantity ?? 0;

  const handlePurchase = async () => {
    if (!confirmItem || purchasing) return;
    setPurchasing(true);
    try {
      const totalPrice = confirmItem.item.price * confirmItem.quantity;
      // Bulk discount for 5x
      const finalPrice = confirmItem.quantity === 5 ? Math.floor(totalPrice * 0.9) : totalPrice;

      const res = await fetch("/api/shop/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          itemId: confirmItem.item.id,
          itemType: confirmItem.item.type,
          price: finalPrice,
          quantity: confirmItem.quantity,
          itemName: confirmItem.item.name,
          rarity: confirmItem.item.rarity,
        }),
      });

      if (res.ok) {
        setShowBurst(true);
        await refreshUser();
        await loadInventory();
      }
    } catch { /* ignore */ }
    setPurchasing(false);
    setConfirmItem(null);
  };

  const handleEquip = async (itemId: string) => {
    try {
      await fetch("/api/shop/equip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, itemId }),
      });
      await loadInventory();
    } catch { /* ignore */ }
  };

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "featured", label: "Featured", icon: "⭐" },
    { key: "cosmetics", label: "Cosmetics", icon: "🎨" },
    { key: "boosters", label: "Boosters", icon: "🚀" },
    { key: "inventory", label: "Inventory", icon: "🎒" },
  ];

  const COSMETIC_SUBS: { key: CosmeticSub; label: string }[] = [
    { key: "frames", label: "Frames" },
    { key: "backgrounds", label: "Backgrounds" },
    { key: "name_colors", label: "Name Colors" },
    { key: "banners", label: "Banners" },
  ];

  const cosmeticTypeMap: Record<CosmeticSub, ItemType> = {
    frames: "frame", backgrounds: "background", name_colors: "name_color", banners: "banner",
  };
  const filteredCosmetics = COSMETIC_ITEMS.filter((i) => i.type === cosmeticTypeMap[cosmeticSub]);

  const ownedCosmetics = inventory.filter((o) => {
    const item = [...COSMETIC_ITEMS, ...FEATURED_ITEMS].find((i) => i.id === o.itemId);
    return item && item.type !== "booster";
  });
  const ownedBoosters = inventory.filter((o) => {
    const item = [...BOOSTER_ITEMS, ...FEATURED_ITEMS].find((i) => i.id === o.itemId);
    return item && item.type === "booster";
  });

  const allItems = [...COSMETIC_ITEMS, ...BOOSTER_ITEMS, ...FEATURED_ITEMS];
  const findItem = (id: string) => allItems.find((i) => i.id === id);

  return (
    <div className="min-h-screen pt-16 pb-24 md:pb-12">
      {/* Purchase burst effect */}
      {showBurst && <PurchaseBurst onDone={() => setShowBurst(false)} />}

      {/* Confirm modal */}
      {confirmItem && (
        <ConfirmModal
          item={confirmItem.item}
          quantity={confirmItem.quantity}
          onConfirm={handlePurchase}
          onCancel={() => setConfirmItem(null)}
          userCoins={user.coins}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ── Header ── */}
        <div className={`text-center mb-8 transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          <div className="flex items-center justify-center gap-3 mb-2">
            <span className="text-4xl sm:text-5xl">🏛️</span>
            <h1 className="font-bebas text-5xl sm:text-7xl shop-title-glow tracking-wider">
              THE LION&apos;S DEN
            </h1>
            <span className="text-4xl sm:text-5xl">🐾</span>
          </div>
          <p className="text-cream/40 text-sm font-semibold tracking-widest uppercase">Premium Item Shop</p>

          {/* Coin balance */}
          <div className="inline-flex items-center gap-2 mt-4 px-5 py-2 rounded-full"
            style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)" }}>
            <span className="text-lg">🪙</span>
            <span className="font-bebas text-3xl text-gold tracking-wider">{formatCoins(user.coins)}</span>
            <span className="text-cream/30 text-xs ml-1">coins</span>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className={`flex items-center justify-center gap-1 sm:gap-2 mb-8 transition-all duration-700 delay-100 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 sm:px-5 py-2 rounded-xl text-sm font-bold transition-all duration-200
                ${tab === t.key
                  ? "bg-electric/15 text-electric border border-electric/30"
                  : "text-cream/40 hover:text-cream hover:bg-white/5 border border-transparent"
                }`}>
              <span>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* ══════════ FEATURED TAB ══════════ */}
        {tab === "featured" && (
          <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            {/* Weekly banner */}
            <div className="flex items-center justify-between mb-6 px-4 py-3 rounded-xl"
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
                <FeaturedCard
                  key={item.id}
                  item={item}
                  owned={ownedIds.has(item.id)}
                  onBuy={() => setConfirmItem({ item, quantity: 1 })}
                />
              ))}
            </div>
          </div>
        )}

        {/* ══════════ COSMETICS TAB ══════════ */}
        {tab === "cosmetics" && (
          <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            {/* Sub-category tabs */}
            <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-hide">
              {COSMETIC_SUBS.map((s) => (
                <button key={s.key} onClick={() => setCosmeticSub(s.key)}
                  className={`px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-all ${cosmeticSub === s.key
                    ? "bg-electric/15 text-electric border border-electric/30"
                    : "text-cream/40 hover:text-cream border border-transparent hover:border-white/10"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {filteredCosmetics.map((item) => (
                <CosmeticCard
                  key={item.id}
                  item={item}
                  owned={ownedIds.has(item.id)}
                  canAfford={user.coins >= item.price}
                  onBuy={() => setConfirmItem({ item, quantity: 1 })}
                />
              ))}
            </div>
          </div>
        )}

        {/* ══════════ BOOSTERS TAB ══════════ */}
        {tab === "boosters" && (
          <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            <div className="space-y-3">
              {BOOSTER_ITEMS.map((item) => (
                <BoosterCard
                  key={item.id}
                  item={item}
                  quantityOwned={getQuantity(item.id)}
                  canAfford={user.coins >= item.price}
                  onBuy={(qty) => setConfirmItem({ item, quantity: qty })}
                />
              ))}
            </div>
          </div>
        )}

        {/* ══════════ INVENTORY TAB ══════════ */}
        {tab === "inventory" && (
          <div className={`transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
            {ownedCosmetics.length === 0 && ownedBoosters.length === 0 ? (
              <div className="text-center py-20">
                <span className="text-6xl block mb-4">🛍️</span>
                <p className="font-bebas text-2xl text-cream/40 tracking-wider">Your inventory is empty</p>
                <p className="text-cream/25 text-sm mt-1">Purchase items from the shop to see them here</p>
                <button onClick={() => setTab("featured")} className="mt-6 btn-outline px-6 py-2 rounded-xl text-sm">
                  Browse Shop
                </button>
              </div>
            ) : (
              <>
                {/* Cosmetics section */}
                {ownedCosmetics.length > 0 && (
                  <div className="mb-8">
                    <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2">
                      <span>🎨</span> Cosmetics
                    </h3>
                    <div className="space-y-2">
                      {ownedCosmetics.map((owned) => {
                        const item = findItem(owned.itemId);
                        if (!item) return null;
                        return (
                          <InventoryItem
                            key={owned.itemId}
                            item={item}
                            owned={owned}
                            onEquip={() => handleEquip(owned.itemId)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Boosters section */}
                {ownedBoosters.length > 0 && (
                  <div>
                    <h3 className="font-bebas text-xl text-cream/60 tracking-wider mb-4 flex items-center gap-2">
                      <span>🚀</span> Boosters
                    </h3>
                    <div className="space-y-2">
                      {ownedBoosters.map((owned) => {
                        const item = findItem(owned.itemId);
                        if (!item) return null;
                        return (
                          <InventoryItem
                            key={owned.itemId}
                            item={item}
                            owned={owned}
                            onEquip={() => {}}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
