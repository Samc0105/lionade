// Shop catalog — single source of truth for shop items.
// SERVER routes look up price/effect from this file (NEVER trust the client).
// CLIENT components also import from here for display.

export type Rarity = "common" | "rare" | "epic" | "legendary";
export type ItemType = "frame" | "background" | "name_color" | "banner" | "booster";
export type BoosterEffect =
  | "coin_multiplier"
  | "xp_multiplier"
  | "extra_time"
  | "auto_correct"
  | "fifty_fifty"
  | "score_boost"
  | "streak_shield";

export interface ShopItem {
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

export interface PremiumItem {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  rarity: Rarity;
  priceUSD: number;
  icon: string;
}

export const COSMETIC_ITEMS: ShopItem[] = [
  { id: "frame_basic_blue", name: "Electric Blue", description: "Clean electric blue border", type: "frame", rarity: "common", price: 25, icon: "🔵" },
  { id: "frame_fire", name: "Inferno Ring", description: "Burning ring of fire around your avatar", type: "frame", rarity: "rare", price: 100, icon: "🔥" },
  { id: "frame_crystal", name: "Crystal Prism", description: "Refracting crystal light frame", type: "frame", rarity: "epic", price: 250, icon: "💎" },
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 500, icon: "🦁" },
  { id: "name_ice", name: "Ice Blue", description: "Frosty ice blue name", type: "name_color", rarity: "common", price: 20, icon: "🧊" },
  { id: "name_emerald", name: "Emerald Green", description: "Rich emerald name color", type: "name_color", rarity: "rare", price: 90, icon: "💚" },
  { id: "name_amethyst", name: "Amethyst Purple", description: "Deep amethyst glow", type: "name_color", rarity: "epic", price: 200, icon: "💜" },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis effect", type: "name_color", rarity: "legendary", price: 450, icon: "🌈" },
  { id: "banner_starter", name: "Starter Banner", description: "Simple gradient banner", type: "banner", rarity: "common", price: 15, icon: "🏳️" },
  { id: "banner_warrior", name: "Warrior Banner", description: "Battle-worn warrior flag", type: "banner", rarity: "rare", price: 120, icon: "⚔️" },
  { id: "banner_galaxy", name: "Galaxy Banner", description: "Full galaxy panorama", type: "banner", rarity: "epic", price: 280, icon: "✨" },
  { id: "banner_legend", name: "Legend Banner", description: "Only for the truly legendary", type: "banner", rarity: "legendary", price: 750, icon: "👑" },
];

export const BOOSTER_ITEMS: ShopItem[] = [
  { id: "boost_coin_rush", name: "Coin Rush", description: "2x coins earned on your next quiz", type: "booster", rarity: "rare", price: 75, icon: "💰", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_xp_surge", name: "XP Surge", description: "2x XP earned on your next quiz", type: "booster", rarity: "rare", price: 75, icon: "⚡", boosterEffect: "xp_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_streak_shield", name: "Streak Shield", description: "Protects your streak for one missed day", type: "booster", rarity: "epic", price: 150, icon: "🛡️", boosterEffect: "streak_shield", boosterValue: 0, boosterDuration: 1 },
  { id: "boost_double_down", name: "Double Down", description: "Double coins AND XP on next quiz", type: "booster", rarity: "epic", price: 200, icon: "🎲", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_lucky_start", name: "Lucky Start", description: "First question auto-correct", type: "booster", rarity: "rare", price: 100, icon: "🍀", boosterEffect: "auto_correct", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_time_warp", name: "Time Warp", description: "+10 seconds per question", type: "booster", rarity: "common", price: 40, icon: "⏰", boosterEffect: "extra_time", boosterValue: 10, boosterDuration: 1 },
  { id: "boost_brain_freeze", name: "Brain Freeze", description: "50/50 — eliminate two wrong answers once", type: "booster", rarity: "epic", price: 125, icon: "🧊", boosterEffect: "fifty_fifty", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_score_boost", name: "Score Boost", description: "+1 added to your final score", type: "booster", rarity: "common", price: 50, icon: "📈", boosterEffect: "score_boost", boosterValue: 1, boosterDuration: 1 },
];

export const FEATURED_ITEMS: ShopItem[] = [
  COSMETIC_ITEMS.find((i) => i.id === "frame_golden_lion")!,
  BOOSTER_ITEMS.find((i) => i.id === "boost_coin_rush")!,
  COSMETIC_ITEMS.find((i) => i.id === "name_aurora")!,
];

export const PREMIUM_ITEMS: PremiumItem[] = [
  { id: "prem_frame_diamond", name: "Diamond Crown Frame", description: "An ultra-rare diamond-encrusted frame that radiates prestige", type: "frame", rarity: "legendary", priceUSD: 4.99, icon: "💠" },
  { id: "prem_frame_neon", name: "Neon Pulse Frame", description: "Reactive neon border that pulses with energy", type: "frame", rarity: "epic", priceUSD: 2.99, icon: "💫" },
  { id: "prem_name_holo", name: "Holographic Name", description: "Holographic rainbow shift name effect", type: "name_color", rarity: "legendary", priceUSD: 1.99, icon: "🔮" },
  { id: "prem_name_gold", name: "Solid Gold Name", description: "Pure gold name with metallic sheen", type: "name_color", rarity: "epic", priceUSD: 1.49, icon: "🥇" },
  { id: "prem_banner_phoenix", name: "Phoenix Rising", description: "Animated phoenix banner with particle trail", type: "banner", rarity: "legendary", priceUSD: 4.99, icon: "🔱" },
  { id: "prem_banner_void", name: "Void Walker", description: "Dark energy void banner with lightning", type: "banner", rarity: "epic", priceUSD: 3.49, icon: "🌀" },
  { id: "prem_frame_starfield", name: "Starfield Frame", description: "Animated stars orbiting your avatar", type: "frame", rarity: "rare", priceUSD: 1.99, icon: "⭐" },
  { id: "prem_banner_lightning", name: "Thunder Strike", description: "Crackling lightning bolt banner", type: "banner", rarity: "rare", priceUSD: 2.49, icon: "⚡" },
  { id: "prem_name_fire", name: "Flame Name", description: "Burning flame text effect", type: "name_color", rarity: "rare", priceUSD: 0.99, icon: "🔥" },
];

// All purchasable Fangs items combined — used by server lookup
const ALL_FANG_ITEMS: ShopItem[] = [...COSMETIC_ITEMS, ...BOOSTER_ITEMS];

/**
 * Server-side lookup for an item by id. Returns the canonical
 * server-controlled price/effect/type. Use this in /api/shop/* routes
 * instead of trusting client-supplied price.
 */
export function getShopItem(id: string): ShopItem | null {
  return ALL_FANG_ITEMS.find((i) => i.id === id) ?? null;
}
