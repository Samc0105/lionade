/**
 * Shop catalog — single source of truth for shop items.
 *
 * SERVER routes look up price/effect from this file (NEVER trust the client).
 * CLIENT components also import from here for display.
 *
 * Moved from web /lib/shop-catalog.ts on 2026-05-13.
 */

export type Rarity = "common" | "rare" | "epic" | "legendary";
export type ItemType =
  | "frame"
  | "background"
  | "name_color"
  | "banner"
  | "booster"
  | "avatar_aura"
  | "voice_skin"
  // Shop V2 — Identity & Status Pack (2026-06-03)
  | "username_effect"
  | "animated_banner"
  | "founder_badge"
  | "earned_medal"
  | "profile_flair";
export type BoosterEffect =
  | "coin_multiplier"
  | "xp_multiplier"
  // Double Down — applies BOTH coin AND xp multipliers in one effect so it
  // does not collide with coin_multiplier / xp_multiplier in active_boosters
  // (activate-booster rejects a second booster sharing an effect id).
  | "coin_xp_multiplier"
  | "extra_time"
  | "auto_correct"
  | "fifty_fifty"
  | "score_boost"
  | "streak_shield"
  | "mastery_hint";

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

/**
 * Founder badges have an enforced grant cap. Set `cap` to the maximum number
 * of accounts that can ever own the badge; `is_founder_cap_open(id, cap)` is
 * the RPC the server calls before allowing a purchase or auto-grant.
 *
 * `purchasable` distinguishes the buy-with-cash founder bundle (e.g.
 * Founding Scholar at $14.99) from the earned-only founder badges
 * (Lionade OG, Beta Witness) which are NEVER for sale.
 */
export interface FounderBadgeItem {
  id: string;
  name: string;
  description: string;
  type: "founder_badge";
  rarity: Rarity;
  cap: number;
  icon: string;
  // Set when this is a one-time bundle purchasable through Stripe IAP.
  priceUSD?: number;
  // Set when the badge is granted automatically (no purchase flow).
  autoGrant?: boolean;
  // True when the badge is offered in the shop UI as a Stripe bundle.
  purchasable: boolean;
}

/**
 * Earned cosmetics — NEVER purchasable. Granted via dedicated RPCs and
 * stored in `earned_cosmetics`. The shop UI may render these as "locked /
 * earn it by …" cards but `/api/shop/purchase` rejects them with 400.
 *
 * `dynamic` items (e.g. mastery medals) have an id PREFIX in this catalog
 * and the actual id is generated server-side per source key
 * (e.g. `medal_mastery_subject_aws_sec_specialty`).
 */
export interface EarnedCosmeticItem {
  id: string; // exact id, or prefix when dynamic=true
  name: string;
  description: string;
  type: "earned_medal" | "profile_flair";
  rarity: Rarity;
  icon: string;
  howToEarn: string;
  dynamic?: boolean;
}

export const COSMETIC_ITEMS: ShopItem[] = [
  { id: "frame_basic_blue", name: "Electric Blue", description: "Clean electric blue border", type: "frame", rarity: "common", price: 800, icon: "🔵" },
  { id: "frame_fire", name: "Inferno Ring", description: "Burning ring of fire around your avatar", type: "frame", rarity: "rare", price: 2200, icon: "🔥" },
  { id: "frame_crystal", name: "Crystal Prism", description: "Refracting crystal light frame", type: "frame", rarity: "epic", price: 5000, icon: "💎" },
  { id: "frame_golden_lion", name: "Golden Lion Frame", description: "A majestic golden frame fit for a king", type: "frame", rarity: "legendary", price: 13000, icon: "🦁" },
  { id: "name_ice", name: "Ice Blue", description: "Frosty ice blue name", type: "name_color", rarity: "common", price: 700, icon: "🧊" },
  { id: "name_emerald", name: "Emerald Green", description: "Rich emerald name color", type: "name_color", rarity: "rare", price: 2000, icon: "💚" },
  { id: "name_amethyst", name: "Amethyst Purple", description: "Deep amethyst glow", type: "name_color", rarity: "epic", price: 4800, icon: "💜" },
  { id: "name_aurora", name: "Aurora Name Color", description: "Shifting aurora borealis effect", type: "name_color", rarity: "legendary", price: 12000, icon: "🌈" },
  { id: "banner_starter", name: "Starter Banner", description: "Simple gradient banner", type: "banner", rarity: "common", price: 700, icon: "🏳️" },
  { id: "banner_warrior", name: "Warrior Banner", description: "Battle-worn warrior flag", type: "banner", rarity: "rare", price: 2300, icon: "⚔️" },
  { id: "banner_galaxy", name: "Galaxy Banner", description: "Full galaxy panorama", type: "banner", rarity: "epic", price: 5200, icon: "✨" },
  { id: "banner_legend", name: "Legend Banner", description: "Only for the truly legendary", type: "banner", rarity: "legendary", price: 15000, icon: "👑" },
];

export const BOOSTER_ITEMS: ShopItem[] = [
  { id: "boost_coin_rush", name: "Fang Rush", description: "2x Fangs earned on your next quiz", type: "booster", rarity: "rare", price: 300, icon: "💰", boosterEffect: "coin_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_xp_surge", name: "XP Surge", description: "2x XP earned on your next quiz", type: "booster", rarity: "rare", price: 300, icon: "⚡", boosterEffect: "xp_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_streak_shield", name: "Streak Shield", description: "Protects your streak for one missed day", type: "booster", rarity: "epic", price: 550, icon: "🛡️", boosterEffect: "streak_shield", boosterValue: 0, boosterDuration: 1 },
  // Double Down uses the combined coin_xp_multiplier effect so it applies BOTH
  // a coin AND an xp 2x multiplier without colliding with Coin Rush / XP Surge.
  { id: "boost_double_down", name: "Double Down", description: "Double Fangs AND XP on next quiz", type: "booster", rarity: "epic", price: 650, icon: "🎲", boosterEffect: "coin_xp_multiplier", boosterValue: 2, boosterDuration: 1 },
  { id: "boost_lucky_start", name: "Lucky Start", description: "First question auto-correct", type: "booster", rarity: "rare", price: 350, icon: "🍀", boosterEffect: "auto_correct", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_time_warp", name: "Time Warp", description: "+10 seconds per question", type: "booster", rarity: "common", price: 150, icon: "⏰", boosterEffect: "extra_time", boosterValue: 10, boosterDuration: 1 },
  { id: "boost_brain_freeze", name: "Brain Freeze", description: "50/50 — eliminate two wrong answers once", type: "booster", rarity: "epic", price: 450, icon: "🧊", boosterEffect: "fifty_fifty", boosterValue: 1, boosterDuration: 1 },
  { id: "boost_score_boost", name: "Score Boost", description: "+1 added to your final score", type: "booster", rarity: "common", price: 180, icon: "📈", boosterEffect: "score_boost", boosterValue: 1, boosterDuration: 1 },
  // 2026-06-02 — Mastery Hint Pack (5 hints). Dollar IAP via Stripe deferred to V2.
  { id: "boost_mastery_hint_pack", name: "Mastery Hint Pack", description: "5 hints to use in Mastery Mode sessions", type: "booster", rarity: "rare", price: 900, icon: "💡", boosterEffect: "mastery_hint", boosterValue: 5, boosterDuration: 5 },
  // 2026-06-02 — Streak Shield 3-pack. Stacks with single shield.
  { id: "boost_streak_shield_3pack", name: "Streak Shield 3-pack", description: "Protect your streak for 3 missed days", type: "booster", rarity: "epic", price: 1400, icon: "🛡️", boosterEffect: "streak_shield", boosterValue: 0, boosterDuration: 3 },
];

// 2026-06-02 — Avatar Aura Pack: 10 cosmetic auras at 200-400 Fangs.
// Placeholder icons; design owns final visual treatment.
export const AVATAR_AURAS: ShopItem[] = [
  { id: "aura_solar", name: "Solar Aura", description: "Warm solar flare around your avatar", type: "avatar_aura", rarity: "common", price: 900, icon: "☀️" },
  { id: "aura_lunar", name: "Lunar Aura", description: "Cool moonlight halo", type: "avatar_aura", rarity: "common", price: 900, icon: "🌙" },
  { id: "aura_emerald", name: "Emerald Aura", description: "Verdant green energy ring", type: "avatar_aura", rarity: "common", price: 1100, icon: "🟢" },
  { id: "aura_sapphire", name: "Sapphire Aura", description: "Deep sapphire shimmer", type: "avatar_aura", rarity: "rare", price: 2000, icon: "🔷" },
  { id: "aura_ruby", name: "Ruby Aura", description: "Pulsing ruby glow", type: "avatar_aura", rarity: "rare", price: 2100, icon: "🔴" },
  { id: "aura_amethyst", name: "Amethyst Aura", description: "Violet amethyst mist", type: "avatar_aura", rarity: "rare", price: 2300, icon: "🟣" },
  { id: "aura_storm", name: "Storm Aura", description: "Crackling storm cloud aura", type: "avatar_aura", rarity: "epic", price: 4400, icon: "⛈️" },
  { id: "aura_inferno", name: "Inferno Aura", description: "Roaring flame aura", type: "avatar_aura", rarity: "epic", price: 4800, icon: "🔥" },
  { id: "aura_void", name: "Void Aura", description: "Inky void with starlight motes", type: "avatar_aura", rarity: "epic", price: 5500, icon: "🌌" },
  { id: "aura_prismatic", name: "Prismatic Aura", description: "Refracting rainbow halo", type: "avatar_aura", rarity: "legendary", price: 11000, icon: "🌈" },
];

// 2026-06-02 — Ninny Voice Skin (single SKU for V1; more voices follow).
export const VOICE_SKINS: ShopItem[] = [
  { id: "voice_ninny_classic", name: "Ninny Voice Skin", description: "Unlock Ninny's signature voice in chat", type: "voice_skin", rarity: "epic", price: 6000, icon: "🎙️" },
];

// 2026-06-03 — Shop V2 Identity & Status Pack: 6 animated username effects.
// The Fangs SKUs render a static gradient version of the effect; the
// `_premium` SKUs purchased with cash render the full WebGL or particle
// treatment. Both grant via the same `name_fx_<theme>` family so the equip
// flow stays simple — the renderer reads ownership and picks the highest
// fidelity variant the user owns.
export const USERNAME_EFFECTS: ShopItem[] = [
  { id: "name_fx_rainbow", name: "Rainbow Shimmer", description: "Animated rainbow shimmer across your username", type: "username_effect", rarity: "rare", price: 16000, icon: "🌈" },
  { id: "name_fx_fire", name: "Fire Effect", description: "Flickering flames trace your username", type: "username_effect", rarity: "rare", price: 20000, icon: "🔥" },
  { id: "name_fx_holographic", name: "Holographic", description: "Iridescent holographic sweep over your username", type: "username_effect", rarity: "epic", price: 28000, icon: "🔮" },
  { id: "name_fx_gold", name: "Gold Sheen", description: "Polished gold sheen on every letter", type: "username_effect", rarity: "epic", price: 24000, icon: "🥇" },
  { id: "name_fx_glitch", name: "Glitch", description: "Digital glitch distortion on your username", type: "username_effect", rarity: "epic", price: 32000, icon: "📺" },
  { id: "name_fx_galaxy", name: "Galaxy Shimmer", description: "Drifting galaxy starfield inside your letters", type: "username_effect", rarity: "legendary", price: 45000, icon: "🌌" },
];

// 2026-06-03 — Shop V2 Identity & Status Pack: 5 premium cosmetic banners
// purchased with Fangs. These are higher-tier than the original BANNER set
// and render with motion (particles, gradient flow, etc.).
export const ANIMATED_BANNERS: ShopItem[] = [
  { id: "banner_interstellar", name: "Interstellar", description: "Drifting star particles across deep space", type: "animated_banner", rarity: "epic", price: 26000, icon: "🌠" },
  { id: "banner_aurora", name: "Aurora", description: "Northern lights gradient flowing edge to edge", type: "animated_banner", rarity: "epic", price: 30000, icon: "🌌" },
  { id: "banner_ink_splash", name: "Ink Splash", description: "Animated ink drops blooming across the banner", type: "animated_banner", rarity: "epic", price: 34000, icon: "🖋️" },
  { id: "banner_honeycomb", name: "Honeycomb", description: "Geometric honeycomb pattern with soft shimmer", type: "animated_banner", rarity: "epic", price: 38000, icon: "🍯" },
  { id: "banner_tidewave", name: "Tidewave", description: "Gentle ocean wave motion across the banner", type: "animated_banner", rarity: "legendary", price: 42000, icon: "🌊" },
];

// 2026-06-03 — Shop V2 Identity & Status Pack: 3 founder badges.
// Founding Scholar is a paid Stripe bundle (capped to 1000); the other two
// are auto-granted by signup order or activity window and NEVER for sale.
export const FOUNDER_BADGES: FounderBadgeItem[] = [
  {
    id: "badge_founding_scholar",
    name: "Founding Scholar",
    description: "Reserved for the first 1000 Pro subscribers. Permanent profile badge.",
    type: "founder_badge",
    rarity: "legendary",
    cap: 1000,
    priceUSD: 14.99,
    purchasable: true,
    icon: "🎓",
  },
  {
    id: "badge_lionade_og",
    name: "Lionade OG",
    description: "First 500 Lionade signups. You were here before the lights came on.",
    type: "founder_badge",
    rarity: "legendary",
    cap: 500,
    autoGrant: true,
    purchasable: false,
    icon: "🦁",
  },
  {
    id: "badge_beta_witness",
    name: "Beta Witness",
    description: "Active before the 2026-06-04 launch deploy.",
    type: "founder_badge",
    rarity: "epic",
    cap: 100000,
    autoGrant: true,
    purchasable: false,
    icon: "👁️",
  },
];

// 2026-06-03 — Shop V2 Identity & Status Pack: earned cosmetics. NOT for sale.
// Granted by dedicated RPCs (see lib/cosmetic-grants.ts). Mastery medals are
// generated dynamically per exam, so the catalog entry is a PREFIX template.
export const EARNED_COSMETICS: EarnedCosmeticItem[] = [
  {
    id: "emblem_streak_10day",
    name: "Streak Warrior 10",
    description: "Earned at a 10-day streak.",
    type: "earned_medal",
    rarity: "rare",
    icon: "🔥",
    howToEarn: "Hit a 10-day login streak.",
  },
  {
    id: "emblem_streak_30day",
    name: "Streak Warrior 30",
    description: "Earned at a 30-day streak.",
    type: "earned_medal",
    rarity: "epic",
    icon: "🔥",
    howToEarn: "Hit a 30-day login streak.",
  },
  {
    id: "emblem_streak_100day",
    name: "Streak Warrior 100",
    description: "Earned at a 100-day streak.",
    type: "earned_medal",
    rarity: "epic",
    icon: "🔥",
    howToEarn: "Hit a 100-day login streak.",
  },
  {
    id: "emblem_streak_365day",
    name: "Streak Warrior 365",
    description: "Earned at a 365-day streak. A full year.",
    type: "earned_medal",
    rarity: "legendary",
    icon: "🔥",
    howToEarn: "Hit a 365-day login streak.",
  },
  {
    id: "badge_polyglot",
    name: "Polyglot",
    description: "Maintains 3 or more language word banks.",
    type: "earned_medal",
    rarity: "epic",
    icon: "🌐",
    howToEarn: "Create 3 or more language vocab banks.",
  },
  {
    id: "badge_knowledge_sharer",
    name: "Knowledge Sharer",
    description: "Your public vocab bank reached 10 clones.",
    type: "earned_medal",
    rarity: "epic",
    icon: "🤝",
    howToEarn: "Have one of your public banks cloned 10 or more times.",
  },
  {
    // Dynamic — actual id is `medal_mastery_subject_<exam_id>`.
    id: "medal_mastery_subject_",
    name: "Mastery Medal",
    description: "Awarded for completing a Mastery subject at 95% or higher.",
    type: "earned_medal",
    rarity: "legendary",
    icon: "🏅",
    howToEarn: "Finish a Mastery subject with a 95% or higher score.",
    dynamic: true,
  },
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
  // 2026-06-03 — Shop V2 Identity & Status Pack: cash variants of the three
  // top-tier username effects. Same `name_fx_<theme>` family as the Fangs
  // SKUs but render the full WebGL/particle treatment.
  { id: "name_fx_holographic_premium", name: "Holographic (Premium)", description: "Full WebGL holographic shift on your username", type: "username_effect", rarity: "legendary", priceUSD: 1.99, icon: "🔮" },
  { id: "name_fx_glitch_premium", name: "Glitch (Premium)", description: "Real-time particle glitch distortion on your username", type: "username_effect", rarity: "legendary", priceUSD: 1.99, icon: "📺" },
  { id: "name_fx_galaxy_premium", name: "Galaxy Shimmer (Premium)", description: "Particle galaxy drift rendered inside your letters", type: "username_effect", rarity: "legendary", priceUSD: 2.99, icon: "🌌" },
  // 2026-06-03 — Shop V2 Identity & Status Pack: 4 cash-only animated banners.
  { id: "banner_premium_aurora_borealis", name: "Aurora Borealis (Premium)", description: "Hi-fi northern lights with parallax depth", type: "animated_banner", rarity: "legendary", priceUSD: 2.99, icon: "🌌" },
  { id: "banner_premium_cosmic_drift", name: "Cosmic Drift", description: "Cinematic cosmic drift with starfield parallax", type: "animated_banner", rarity: "legendary", priceUSD: 3.99, icon: "🪐" },
  { id: "banner_premium_liquid_gold", name: "Liquid Gold", description: "Molten gold flowing across your banner", type: "animated_banner", rarity: "legendary", priceUSD: 2.99, icon: "🥇" },
  { id: "banner_premium_lightning", name: "Lightning Strike (Premium)", description: "Real lightning arcs across the banner", type: "animated_banner", rarity: "epic", priceUSD: 1.99, icon: "⚡" },
];

// All purchasable Fangs items combined — used by server lookup
const ALL_FANG_ITEMS: ShopItem[] = [
  ...COSMETIC_ITEMS,
  ...BOOSTER_ITEMS,
  ...AVATAR_AURAS,
  ...VOICE_SKINS,
  // 2026-06-03 — Shop V2 additions purchasable via Fangs.
  ...USERNAME_EFFECTS,
  ...ANIMATED_BANNERS,
];

/**
 * Server-side lookup for an item by id. Returns the canonical
 * server-controlled price/effect/type. Use this in /api/shop/* routes
 * instead of trusting client-supplied price.
 */
export function getShopItem(id: string): ShopItem | null {
  return ALL_FANG_ITEMS.find((i) => i.id === id) ?? null;
}

/**
 * Founder-badge lookup. Returns the canonical cap + price for SKUs in the
 * FOUNDER_BADGES array. Use this in /api/shop/purchase + Stripe webhook
 * before granting — pair with `is_founder_cap_open(id, cap)` RPC for the
 * race-safe check.
 */
export function getFounderBadge(id: string): FounderBadgeItem | null {
  return FOUNDER_BADGES.find((b) => b.id === id) ?? null;
}

/**
 * Earned-cosmetic lookup. Returns either an exact match OR the dynamic
 * prefix entry when the id starts with the catalog prefix
 * (e.g. `medal_mastery_subject_aws_sec_specialty` resolves to the
 * `medal_mastery_subject_` template). Use this purely for metadata
 * (name/icon/rarity) when rendering an earned grant — these are NEVER
 * purchasable so /api/shop/purchase should reject them outright.
 */
export function getEarnedCosmetic(id: string): EarnedCosmeticItem | null {
  const exact = EARNED_COSMETICS.find((e) => e.id === id);
  if (exact) return exact;
  const dynamic = EARNED_COSMETICS.find(
    (e) => e.dynamic === true && id.startsWith(e.id) && id.length > e.id.length,
  );
  return dynamic ?? null;
}

/**
 * Returns true if the given id is a known earned cosmetic (exact or
 * dynamic-prefix match). Server uses this to short-circuit purchase
 * attempts before any DB work.
 */
export function isEarnedCosmeticId(id: string): boolean {
  return getEarnedCosmetic(id) !== null;
}
