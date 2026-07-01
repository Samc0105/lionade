// Cosmetic Fang sink shop (Idea 42), PREVIEW ONLY. This unifies the cosmetics
// TechHub already grants (desk themes, quest badges, track completion titles)
// into one gallery, and previews a future paid only Fang sink without ever
// moving Fangs.
//
// CRITICAL economy note (the migration is HELD): nothing in this file debits or
// grants Fangs. There is no client side economy mutation and no server call to
// spend. The only state change the shop performs is EQUIPPING a desk theme you
// already own, which is the existing themes.ts mechanism (a local preference),
// not a purchase. The preview Fang balance and the preview prices are display
// only, so the economy stays server authoritative. Real spending goes live with
// the economy.
//
// Pure helpers: the catalog is static (safe during SSR) and getShopView reads
// the existing local stores to resolve owned, equipped, and (preview) affordable
// state. Client intended; it returns neutral defaults during SSR so callers can
// mount guard and never flash a row of zeros.

import type { Track } from "@/lib/helpdesk/types";
import type { Shift } from "./types";
import { TRACKS } from "@/lib/helpdesk/tracks";
import {
  THEMES,
  getEquippedThemeId,
  setEquippedTheme,
  isThemeUnlocked,
  unlockedStreakIds,
  type DeskTheme,
} from "./themes";
import { QUEST_BADGES, getEarnedQuestBadgeIds } from "./quests";
import { getTrackCosmetic, getAllTrackMastery } from "./trackMastery";
import { ACHIEVEMENTS, computeUnlocked } from "./stats";
import { getPlayStreak } from "./playstreak";
import { getAllRecords, PASS_SCORE } from "./campaignProgress";
import { SHIFTS } from "./shifts";

/* ───────────────────────── palette ───────────────────────── */

const GOLD = "#FFD700";
const PURPLE = "#C9A2F2";
const ELECTRIC = "#4A90D9";
const CRIMSON = "#F87171";

// Per theme accent for the gallery tiles, drawn from the TechHub palette (the
// desk themes themselves only carry a near black background, so the gallery
// needs a readable accent to outline each tile).
const THEME_ACCENTS: Record<string, string> = {
  standard: ELECTRIC,
  crt: "#2BBE6B",
  amber: "#FFB020",
  graveyard: "#9DB4E0",
  neon: PURPLE,
  holo: "#22D3EE",
  crimson: CRIMSON,
  legend: GOLD,
  ember: "#FB923C",
  blaze: CRIMSON,
  solar: "#FFB020",
  supernova: PURPLE,
};

/* ───────────────────────── catalog model ───────────────────────── */

export type CosmeticKind = "theme" | "badge" | "title" | "preview";

export interface ShopEntry {
  id: string;
  name: string;
  kind: CosmeticKind;
  /** Accent hex from the dark interstellar palette (gold, purple, electric, crimson). */
  color: string;
  /** What the cosmetic is (user facing). */
  desc: string;
  /** How it is earned (user facing). For "preview" entries this is the coming soon note. */
  unlockHint: string;
  /** Set on equippable desk themes: the themes.ts id that equipping writes. */
  themeId?: string;
  /** Set on track completion titles: the career track that earns the title. */
  trackId?: Track;
  /**
   * Set on "preview" Fang priced cosmetics only: the future price. DISPLAY ONLY.
   * The shop never charges it (the economy is held, so spending is a preview).
   */
  priceFangs?: number;
}

// A short, deterministic preview of paid only cosmetics that would form the
// future Fang sink. These do not exist as real cosmetics yet, so they are never
// owned and never purchasable here. They show a price (display only) and the
// "goes live with the economy" note, so players can see where the sink is
// headed without anything being spent.
const PREVIEW_COSMETICS: ShopEntry[] = [
  { id: "preview-aurora", name: "Aurora Desk", kind: "preview", color: ELECTRIC, desc: "A shifting aurora backdrop for the desk chrome.", unlockHint: "Paid cosmetic. Goes live with the economy.", priceFangs: 1200 },
  { id: "preview-obsidian", name: "Obsidian Desk", kind: "preview", color: PURPLE, desc: "A deep obsidian theme with a violet sheen.", unlockHint: "Paid cosmetic. Goes live with the economy.", priceFangs: 900 },
  { id: "preview-nameplate", name: "Gilded Nameplate", kind: "preview", color: GOLD, desc: "A gold nameplate flourish for your profile.", unlockHint: "Paid cosmetic. Goes live with the economy.", priceFangs: 1500 },
  { id: "preview-cursor", name: "Crimson Cursor", kind: "preview", color: CRIMSON, desc: "A crimson terminal cursor trail.", unlockHint: "Paid cosmetic. Goes live with the economy.", priceFangs: 600 },
];

/** A human readable "how to unlock" line for a desk theme. */
function themeUnlockHint(theme: DeskTheme): string {
  if (theme.unlock === null) return "Available to everyone.";
  if (theme.unlock.startsWith("streak:")) {
    const n = theme.unlock.split(":")[1];
    return `Reach a ${n} day play streak.`;
  }
  const ach = ACHIEVEMENTS.find((a) => a.id === theme.unlock);
  return ach ? `Achievement: ${ach.name}.` : "Earned by an achievement.";
}

/**
 * The full static catalog: every existing cosmetic plus the preview priced
 * future ones. Pure and SSR safe (no localStorage), so a surface can render the
 * shapes and names before mount and resolve owned state afterwards.
 */
export function shopCatalog(): ShopEntry[] {
  const themes: ShopEntry[] = THEMES.map((t): ShopEntry => ({
    id: `theme-${t.id}`,
    name: t.name,
    kind: "theme",
    color: THEME_ACCENTS[t.id] ?? GOLD,
    desc: t.scanlines ? "A desk theme with a scanline overlay." : "A desk theme for the LionDesk chrome.",
    unlockHint: themeUnlockHint(t),
    themeId: t.id,
  }));

  const titles: ShopEntry[] = TRACKS.map((t): ShopEntry => {
    const cos = getTrackCosmetic(t.id);
    return {
      id: `title-${t.id}`,
      name: cos.title,
      kind: "title",
      color: cos.color,
      desc: `The top of ladder title for the ${t.name} track.`,
      unlockHint: `Clear every shift in the ${t.name} track.`,
      trackId: t.id,
    };
  });

  const badges: ShopEntry[] = QUEST_BADGES.map((b): ShopEntry => ({
    id: b.id, // already prefixed "badge-...", unique across kinds
    name: b.name,
    kind: "badge",
    color: b.color,
    desc: b.desc,
    unlockHint: b.tier === "weekly" ? "Clear the matching weekly quest." : "Clear the matching daily quest.",
  }));

  return [...themes, ...titles, ...badges, ...PREVIEW_COSMETICS];
}

/* ───────────────────────── preview Fang balance ───────────────────────── */

/** The authored preview Fangs a single shift is worth (sum of its ticket rewards). */
function shiftPreviewFangs(shift: Shift): number {
  return shift.items.reduce((sum, it) => sum + (it.reward || 0), 0);
}

/**
 * The player's PREVIEW Fang balance: the preview Fangs they have earned across
 * the campaign shifts they have cleared. DISPLAY ONLY. This is not a real wallet
 * balance (the economy is server authoritative and the migration is held), so it
 * is never spent or debited. Returns 0 during SSR; callers mount guard.
 */
export function previewFangBalance(): number {
  if (typeof window === "undefined") return 0;
  const records = getAllRecords();
  let total = 0;
  for (const shift of SHIFTS) {
    const r = records[shift.id];
    if (r && r.bestScore >= PASS_SCORE) total += shiftPreviewFangs(shift);
  }
  return total;
}

/* ───────────────────────── computed view ───────────────────────── */

export interface ShopEntryView extends ShopEntry {
  /** Earned via streak / quest / track completion / achievement (or always free). */
  owned: boolean;
  /** Desk themes only: this theme is the one currently equipped. */
  equipped: boolean;
  /**
   * Preview priced entries only: whether the preview Fang balance would cover
   * the price. PREVIEW signal, it never enables a real purchase.
   */
  affordable: boolean;
}

export interface ShopView {
  entries: ShopEntryView[];
  /** Preview Fang balance (display only, never spent). */
  balance: number;
  ownedCount: number;
  totalCount: number;
}

/**
 * The catalog resolved against the live local stores: owned, equipped, and
 * (preview) affordable state plus the preview Fang balance. Reads localStorage,
 * so call it after mount; during SSR it returns the catalog with neutral state
 * and a zero balance so the UI can mount guard and never flash a row of zeros.
 */
export function getShopView(): ShopView {
  const catalog = shopCatalog();
  if (typeof window === "undefined") {
    return {
      entries: catalog.map((e) => ({ ...e, owned: false, equipped: false, affordable: false })),
      balance: 0,
      ownedCount: 0,
      totalCount: catalog.length,
    };
  }

  // Themes resolve via the achievement set merged with the streak unlock ids
  // (the same blend AchievementsPanel uses). Concatenating two arrays, no Set
  // spreading.
  const themeUnlockSet = [...computeUnlocked(), ...unlockedStreakIds(getPlayStreak().best)];
  const equippedThemeId = getEquippedThemeId();
  const earnedBadges = new Set(getEarnedQuestBadgeIds());
  const completedTracks = new Set(getAllTrackMastery().filter((m) => m.complete).map((m) => m.id));
  const balance = previewFangBalance();

  const entries: ShopEntryView[] = catalog.map((e) => {
    let owned = false;
    let equipped = false;
    if (e.kind === "theme" && e.themeId) {
      const theme = THEMES.find((t) => t.id === e.themeId);
      owned = !!theme && isThemeUnlocked(theme, themeUnlockSet);
      equipped = owned && equippedThemeId === e.themeId;
    } else if (e.kind === "badge") {
      owned = earnedBadges.has(e.id);
    } else if (e.kind === "title" && e.trackId) {
      owned = completedTracks.has(e.trackId);
    }
    // "preview" entries stay unowned: they are paid cosmetics that are not for
    // sale yet (the economy is held).
    const affordable = e.priceFangs !== undefined ? balance >= e.priceFangs : false;
    return { ...e, owned, equipped, affordable };
  });

  return {
    entries,
    balance,
    ownedCount: entries.filter((e) => e.owned).length,
    totalCount: catalog.length,
  };
}

/**
 * Equip an owned desk theme. This is the EXISTING themes.ts mechanism (a local
 * preference), not a purchase: it never moves Fangs. A no op for any non theme
 * entry (badges and titles are collected, not equipped, and preview cosmetics
 * are not for sale yet).
 */
export function equipShopEntry(entry: ShopEntry): void {
  if (entry.kind === "theme" && entry.themeId) setEquippedTheme(entry.themeId);
}
