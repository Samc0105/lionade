import { Subject } from "@/types";

// ─── Utility ──────────────────────────────────────────────────────────────────

// Re-export the new progressive leveling system for backwards compat
export { getLevelProgress, getLevelFromXp as getLevelFromXpNew } from "@/lib/levels";
export const XP_PER_LEVEL = 100; // Base XP (first level) — kept for any legacy refs

export function formatCoins(coins: number): string {
  if (coins >= 1000) return `${(coins / 1000).toFixed(1)}K`;
  return coins.toString();
}

export const SUBJECT_ICONS: Record<string, string> = {
  Math: "🧮",
  Science: "🔬",
  Languages: "🌍",
  Humanities: "📚",
  "Tech & Coding": "💻",
  "Cloud & IT": "☁️",
  "Finance & Business": "💰",
  "Test Prep": "📝",
  // Legacy
  "SAT/ACT": "📝",
  Coding: "💻",
  Finance: "💰",
  Certifications: "🏆",
  History: "🏛️",
  "Social Studies": "🌐",
};

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
