// Cosmetic desk themes, unlocked by achievements and equipped from the profile.
// Each is a background color plus an optional scanline overlay applied to the
// LionDesk chrome. Local only.

export interface DeskTheme {
  id: string;
  name: string;
  /** Achievement id required to unlock, or null for always-available. */
  unlock: string | null;
  bg: string;
  scanlines?: boolean;
}

export const THEMES: DeskTheme[] = [
  { id: "standard", name: "Standard", unlock: null, bg: "#070b14" },
  { id: "crt", name: "CRT Green", unlock: "night-owl", bg: "#04120a", scanlines: true },
  { id: "amber", name: "Amber Terminal", unlock: "generalist", bg: "#120c03", scanlines: true },
  { id: "graveyard", name: "Graveyard", unlock: "dawn", bg: "#04060c", scanlines: true },
  { id: "neon", name: "Neon", unlock: "promoted", bg: "#0a0418", scanlines: true },
  { id: "holo", name: "Holo", unlock: "beloved", bg: "#04121a", scanlines: true },
  { id: "crimson", name: "Crimson", unlock: "iron-desk", bg: "#140404", scanlines: true },
  { id: "legend", name: "Gold Desk", unlock: "desk-legend", bg: "#0c0a04" },
  // Streak-gated cosmetics, unlocked by your best daily play streak (the
  // "streak:N" ids resolve via unlockedStreakIds + lib/liondesk/playstreak.ts).
  // Purely cosmetic progression, never any Fangs.
  { id: "ember", name: "Ember", unlock: "streak:3", bg: "#120803", scanlines: true },
  { id: "blaze", name: "Blaze", unlock: "streak:7", bg: "#170a02", scanlines: true },
  { id: "solar", name: "Solar Flare", unlock: "streak:14", bg: "#1a0b02", scanlines: true },
  { id: "supernova", name: "Supernova", unlock: "streak:30", bg: "#0b0416" },
];

const KEY = "lionade.techhub.theme.v1";

export function getTheme(id: string | null | undefined): DeskTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function getEquippedThemeId(): string {
  if (typeof window === "undefined") return "standard";
  try {
    return window.localStorage.getItem(KEY) || "standard";
  } catch {
    return "standard";
  }
}

export function getEquippedTheme(): DeskTheme {
  return getTheme(getEquippedThemeId());
}

export function setEquippedTheme(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function isThemeUnlocked(theme: DeskTheme, unlocked: string[]): boolean {
  return theme.unlock === null || unlocked.includes(theme.unlock);
}

/**
 * Streak unlock ids satisfied by a best streak of `best` days. Merge these into
 * the achievement unlock set before calling isThemeUnlocked so the streak-gated
 * themes resolve. Gated on best (not current) so an earned cosmetic stays
 * unlocked even after the streak lapses.
 */
export function unlockedStreakIds(best: number): string[] {
  return THEMES
    .map((t) => t.unlock)
    .filter((u): u is string => !!u && u.startsWith("streak:"))
    .filter((u) => best >= Number(u.split(":")[1]));
}
