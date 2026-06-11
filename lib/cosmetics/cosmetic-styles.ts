/**
 * cosmetic-styles.ts — Shop V2 cosmetic visual maps (2026-06-09)
 *
 * The shop catalog (packages/lionade-core/.../shop-catalog.ts) carries only
 * id / name / type / rarity / price / emoji. It has NO visual metadata. This
 * file owns the id -> visual style maps the renderers (Avatar, AnimatedUsername,
 * profile banner strip) consult to actually PAINT a purchased cosmetic.
 *
 * Design rules (all enforced here):
 *   - Frames   = a colored ring drawn via box-shadow rings (no layout shift).
 *   - Auras    = an outer glow halo (radial gradient + blur), sits BEHIND avatar.
 *   - Names    = a solid color or a gradient (background-clip: text).
 *   - Banners  = a gradient / pattern fill for the profile hero strip.
 *
 * Animated variants are an EXPLICIT allow-list by id, never "all banners" or
 * "all auras". Notably the cash premium banners typed `banner`
 * (prem_banner_phoenix / prem_banner_void / prem_banner_lightning) ARE animated
 * even though their catalog type is the static `banner` type.
 *
 * Every lookup degrades to `null` for an unknown id so nothing crashes if the
 * catalog drifts or the migration / backend lags. Animated classes are tokens
 * that map to keyframes in app/globals.css (cos-frame-*, cos-aura-*, cos-banner-*,
 * cos-name-*); they are GPU-only and reduced-motion safe in CSS.
 */

export interface FrameStyle {
  /** CSS color used for the ring (box-shadow rings layer this). */
  ring: string;
  /** Optional second ring color for a layered / gradient-ish look. */
  ring2?: string;
  /** Outer glow color for the ring (subtle, distinct from an aura). */
  glow?: string;
  /** Animated class token (maps to globals.css). Omit for a static ring. */
  animClass?: string;
}

export interface AuraStyle {
  /** Inner color of the radial halo. */
  color: string;
  /** Optional second color for a two-tone halo. */
  color2?: string;
  /** Animated class token (maps to globals.css). Omit for a static halo. */
  animClass?: string;
}

export interface NameColorStyle {
  /** Solid color OR omit when using a gradient. */
  color?: string;
  /** CSS gradient string; when set the name uses background-clip: text. */
  gradient?: string;
  /** Animated class token (e.g. shifting aurora). Omit for a static color. */
  animClass?: string;
}

export interface BannerStyle {
  /** CSS background (gradient / layered pattern) for the hero strip. */
  background: string;
  /** Optional background-size when the animation pans the gradient. */
  backgroundSize?: string;
  /** Animated class token (maps to globals.css). Omit for a static fill. */
  animClass?: string;
}

/* ── FRAMES — colored ring via box-shadow ─────────────────────────────── */
export const FRAME_STYLES: Record<string, FrameStyle> = {
  // Fang cosmetics
  frame_basic_blue: { ring: "#4A90D9", glow: "rgba(74,144,217,0.45)" },
  frame_fire: { ring: "#FF4500", ring2: "#FF8C00", glow: "rgba(255,69,0,0.5)", animClass: "cos-frame-fire" },
  frame_crystal: { ring: "#A0E9FF", ring2: "#C0B6FF", glow: "rgba(160,233,255,0.5)", animClass: "cos-frame-crystal" },
  frame_golden_lion: { ring: "#FFD700", ring2: "#B8860B", glow: "rgba(255,215,0,0.55)", animClass: "cos-frame-gold" },
  // Cash premium frames
  prem_frame_diamond: { ring: "#B9F2FF", ring2: "#FFFFFF", glow: "rgba(185,242,255,0.6)", animClass: "cos-frame-diamond" },
  prem_frame_neon: { ring: "#FF1493", ring2: "#00BFFF", glow: "rgba(255,20,147,0.55)", animClass: "cos-frame-neon" },
  prem_frame_starfield: { ring: "#9370DB", ring2: "#4A90D9", glow: "rgba(147,112,219,0.55)", animClass: "cos-frame-starfield" },
};

/* ── AURAS — outer glow halo behind the avatar ────────────────────────── */
export const AURA_STYLES: Record<string, AuraStyle> = {
  aura_solar: { color: "rgba(255,180,60,0.6)", color2: "rgba(255,120,0,0.35)", animClass: "cos-aura-pulse" },
  aura_lunar: { color: "rgba(190,210,255,0.55)", color2: "rgba(120,150,220,0.3)", animClass: "cos-aura-pulse" },
  aura_emerald: { color: "rgba(46,204,113,0.55)", color2: "rgba(20,140,80,0.3)", animClass: "cos-aura-pulse" },
  aura_sapphire: { color: "rgba(74,144,217,0.6)", color2: "rgba(40,90,180,0.32)", animClass: "cos-aura-pulse" },
  aura_ruby: { color: "rgba(231,76,60,0.6)", color2: "rgba(170,30,30,0.32)", animClass: "cos-aura-pulse" },
  aura_amethyst: { color: "rgba(168,85,247,0.6)", color2: "rgba(110,40,180,0.32)", animClass: "cos-aura-pulse" },
  aura_storm: { color: "rgba(120,160,220,0.6)", color2: "rgba(60,80,130,0.34)", animClass: "cos-aura-flicker" },
  aura_inferno: { color: "rgba(255,90,20,0.65)", color2: "rgba(180,40,0,0.35)", animClass: "cos-aura-flicker" },
  aura_void: { color: "rgba(90,40,160,0.6)", color2: "rgba(20,10,60,0.4)", animClass: "cos-aura-swirl" },
  aura_prismatic: { color: "rgba(255,20,147,0.5)", color2: "rgba(0,191,255,0.4)", animClass: "cos-aura-prismatic" },
};

/* ── NAME COLORS — text color / gradient-clip ─────────────────────────── */
export const NAME_COLOR_STYLES: Record<string, NameColorStyle> = {
  // Fang cosmetics
  name_ice: { color: "#A0E9FF" },
  name_emerald: { color: "#2ECC71" },
  name_amethyst: { color: "#A855F7" },
  name_aurora: {
    gradient: "linear-gradient(90deg, #00FF7F, #00BFFF, #9370DB, #FF69B4, #00FF7F)",
    animClass: "cos-name-aurora",
  },
  // Cash premium name colors
  prem_name_holo: {
    gradient: "linear-gradient(90deg, #C0FFEE, #FF1493, #FFD700, #00BFFF, #9370DB, #C0FFEE)",
    animClass: "cos-name-aurora",
  },
  prem_name_gold: {
    gradient: "linear-gradient(90deg, #B8860B, #FFD700, #FFF8DC, #FFD700, #B8860B)",
    animClass: "cos-name-gold",
  },
  prem_name_fire: {
    gradient: "linear-gradient(90deg, #FFD700, #FF8C00, #FF4500, #FF8C00, #FFD700)",
    animClass: "cos-name-fire",
  },
};

/* ── BANNERS — gradient / pattern fills for the profile hero strip ────── */
const DEFAULT_BANNER_BG =
  "radial-gradient(120% 140% at 20% -20%, rgba(74,144,217,0.35) 0%, transparent 55%)," +
  "radial-gradient(120% 140% at 85% 120%, rgba(168,85,247,0.32) 0%, transparent 55%)," +
  "linear-gradient(120deg, #0a1326 0%, #060c18 55%, #0a1020 100%)";

/**
 * The intentional default ambient interstellar gradient. Used when the user
 * has NO banner equipped (an empty banner is NOT a blank/missing box).
 */
export const DEFAULT_BANNER_STYLE: BannerStyle = {
  background: DEFAULT_BANNER_BG,
};

export const BANNER_STYLES: Record<string, BannerStyle> = {
  // Fang cosmetic banners (original set — static fills)
  banner_starter: {
    background: "linear-gradient(120deg, #2D6BB5 0%, #4A90D9 50%, #6AABF0 100%)",
  },
  banner_warrior: {
    background:
      "linear-gradient(120deg, #3a1d12 0%, #6b2f17 45%, #a8501f 100%)," +
      "repeating-linear-gradient(45deg, rgba(0,0,0,0.12) 0 8px, transparent 8px 16px)",
  },
  banner_galaxy: {
    background:
      "radial-gradient(120% 130% at 30% 10%, rgba(147,112,219,0.5) 0%, transparent 55%)," +
      "radial-gradient(120% 130% at 80% 90%, rgba(74,144,217,0.45) 0%, transparent 55%)," +
      "linear-gradient(120deg, #100a2a 0%, #0a0820 60%, #1a0f30 100%)",
  },
  banner_legend: {
    background:
      "linear-gradient(120deg, #B8860B 0%, #FFD700 45%, #FFF8DC 50%, #FFD700 55%, #B8860B 100%)",
    backgroundSize: "250% 100%",
    animClass: "cos-banner-sheen",
  },

  // Shop V2 animated banners (Fangs)
  banner_interstellar: {
    background:
      "radial-gradient(1px 1px at 20% 30%, #fff 50%, transparent 51%)," +
      "radial-gradient(1px 1px at 70% 60%, #cfe3ff 50%, transparent 51%)," +
      "radial-gradient(1px 1px at 45% 80%, #fff 50%, transparent 51%)," +
      "linear-gradient(120deg, #060c18 0%, #0a1326 55%, #08101f 100%)",
    backgroundSize: "200% 100%, 200% 100%, 200% 100%, 100% 100%",
    animClass: "cos-banner-drift",
  },
  banner_aurora: {
    background:
      "linear-gradient(120deg, #00FF7F 0%, #00BFFF 30%, #9370DB 60%, #FF69B4 100%)",
    backgroundSize: "300% 100%",
    animClass: "cos-banner-flow",
  },
  banner_ink_splash: {
    background:
      "radial-gradient(60% 90% at 25% 40%, rgba(168,85,247,0.55) 0%, transparent 60%)," +
      "radial-gradient(50% 80% at 75% 60%, rgba(74,144,217,0.5) 0%, transparent 60%)," +
      "linear-gradient(120deg, #0a0820 0%, #100a2a 100%)",
    backgroundSize: "200% 200%, 200% 200%, 100% 100%",
    animClass: "cos-banner-bloom",
  },
  banner_honeycomb: {
    background:
      "repeating-linear-gradient(60deg, rgba(255,215,0,0.08) 0 10px, transparent 10px 20px)," +
      "repeating-linear-gradient(-60deg, rgba(255,215,0,0.08) 0 10px, transparent 10px 20px)," +
      "linear-gradient(120deg, #1a1405 0%, #0c0a02 100%)",
    backgroundSize: "40px 40px, 40px 40px, 100% 100%",
    animClass: "cos-banner-shimmer",
  },
  banner_tidewave: {
    background:
      "linear-gradient(120deg, #023e58 0%, #0a6e8c 40%, #15a0b5 70%, #0a6e8c 100%)",
    backgroundSize: "300% 100%",
    animClass: "cos-banner-flow",
  },

  // Cash premium animated banners (catalog type animated_banner)
  banner_premium_aurora_borealis: {
    background:
      "linear-gradient(120deg, #00FF7F 0%, #00BFFF 25%, #9370DB 50%, #FF69B4 75%, #00FF7F 100%)",
    backgroundSize: "300% 100%",
    animClass: "cos-banner-flow",
  },
  banner_premium_cosmic_drift: {
    background:
      "radial-gradient(1px 1px at 15% 25%, #fff 50%, transparent 51%)," +
      "radial-gradient(1px 1px at 65% 55%, #cfe3ff 50%, transparent 51%)," +
      "radial-gradient(1px 1px at 40% 85%, #fff 50%, transparent 51%)," +
      "radial-gradient(120% 130% at 80% 20%, rgba(147,112,219,0.4) 0%, transparent 55%)," +
      "linear-gradient(120deg, #08061a 0%, #100a2a 60%, #06040f 100%)",
    backgroundSize: "200% 100%, 200% 100%, 200% 100%, 100% 100%, 100% 100%",
    animClass: "cos-banner-drift",
  },
  banner_premium_liquid_gold: {
    background:
      "linear-gradient(120deg, #8a6508 0%, #FFD700 35%, #FFF8DC 50%, #FFD700 65%, #8a6508 100%)",
    backgroundSize: "250% 100%",
    animClass: "cos-banner-sheen",
  },
  banner_premium_lightning: {
    background:
      "linear-gradient(120deg, #0a1326 0%, #1a2a4a 50%, #0a1326 100%)",
    backgroundSize: "200% 100%",
    animClass: "cos-banner-flicker",
  },

  // Cash premium banners typed `banner` (static type) that MUST be animated.
  prem_banner_phoenix: {
    background:
      "radial-gradient(60% 100% at 50% 110%, rgba(255,140,0,0.55) 0%, transparent 60%)," +
      "linear-gradient(120deg, #2a0a05 0%, #6b1f0a 45%, #c0500f 100%)",
    backgroundSize: "100% 100%, 200% 100%",
    animClass: "cos-banner-flicker",
  },
  prem_banner_void: {
    background:
      "radial-gradient(80% 120% at 50% 50%, rgba(90,40,160,0.5) 0%, transparent 60%)," +
      "linear-gradient(120deg, #08051a 0%, #1a0a3a 50%, #06040f 100%)",
    backgroundSize: "200% 200%, 100% 100%",
    animClass: "cos-banner-bloom",
  },
  prem_banner_lightning: {
    background:
      "linear-gradient(120deg, #0a1326 0%, #233a66 50%, #0a1326 100%)",
    backgroundSize: "200% 100%",
    animClass: "cos-banner-flicker",
  },
};

/* ── Safe lookups (null for unknown ids) ──────────────────────────────── */
export function getFrameStyle(id: string | null | undefined): FrameStyle | null {
  if (!id || id === "none") return null;
  return FRAME_STYLES[id] ?? null;
}

export function getAuraStyle(id: string | null | undefined): AuraStyle | null {
  if (!id || id === "none") return null;
  return AURA_STYLES[id] ?? null;
}

export function getNameColorStyle(id: string | null | undefined): NameColorStyle | null {
  if (!id || id === "none") return null;
  return NAME_COLOR_STYLES[id] ?? null;
}

/**
 * Banner lookup. Unknown / empty id returns the intentional default ambient
 * interstellar gradient (NOT null) so the hero strip is never a blank box.
 * Callers that need to distinguish "equipped vs default" should check the id
 * directly before calling.
 */
export function getBannerStyle(id: string | null | undefined): BannerStyle {
  if (!id || id === "none") return DEFAULT_BANNER_STYLE;
  return BANNER_STYLES[id] ?? DEFAULT_BANNER_STYLE;
}
