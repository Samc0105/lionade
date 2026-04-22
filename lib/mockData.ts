import { Subject } from "@/types";
import {
  Calculator,
  TestTube,
  Globe,
  BookOpen,
  Code,
  Cloud,
  CurrencyDollar,
  NotePencil,
  Trophy,
  HourglassMedium,
  type Icon,
} from "@phosphor-icons/react";

// ─── Utility ──────────────────────────────────────────────────────────────────

// Re-export the new progressive leveling system for backwards compat
export { getLevelProgress, getLevelFromXp as getLevelFromXpNew } from "@/lib/levels";
export const XP_PER_LEVEL = 100; // Base XP (first level) — kept for any legacy refs

export function formatCoins(coins: number): string {
  if (coins >= 1000) return `${(coins / 1000).toFixed(1)}K`;
  return coins.toString();
}

/**
 * Subject iconography. Each entry is a Phosphor icon component — consumers
 * render it as `<Icon size={24} weight="regular" />`. Falls back to `BookOpen`
 * in consumers when a subject isn't mapped.
 */
export const SUBJECT_ICONS: Record<string, Icon> = {
  Math: Calculator,
  Science: TestTube,
  Languages: Globe,
  Humanities: BookOpen,
  "Tech & Coding": Code,
  "Cloud & IT": Cloud,
  "Finance & Business": CurrencyDollar,
  "Test Prep": NotePencil,
  // Legacy subject keys — keep mapped for old records
  "SAT/ACT": NotePencil,
  Coding: Code,
  Finance: CurrencyDollar,
  Certifications: Trophy,
  History: HourglassMedium,
  "Social Studies": Globe,
};

/** Default icon when a subject isn't in the map. Use this at call sites. */
export const DefaultSubjectIcon: Icon = BookOpen;

export const SUBJECT_COLORS: Record<string, string> = {
  Math: "#4A90D9",
  Science: "#2ECC71",
  Languages: "#3B82F6",
  Humanities: "#A855F7",
  "Tech & Coding": "#6B7280",
  "Cloud & IT": "#F97316",
  "Finance & Business": "#EAB308",
  "Test Prep": "#EC4899",
  // Legacy
  "SAT/ACT": "#E67E22",
  Coding: "#1ABC9C",
  Finance: "#FFD700",
  Certifications: "#E91E63",
  History: "#EAB308",
  "Social Studies": "#14B8A6",
};
