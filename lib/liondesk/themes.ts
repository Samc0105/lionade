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
  { id: "legend", name: "Gold Desk", unlock: "desk-legend", bg: "#0c0a04" },
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
