import { Subject } from "@/types";

// ─── Utility ──────────────────────────────────────────────────────────────────

export const XP_PER_LEVEL = 1000;

export function getLevelProgress(xp: number): { level: number; progress: number; xpToNext: number } {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const progress = ((xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;
  const xpToNext = XP_PER_LEVEL - (xp % XP_PER_LEVEL);
  return { level, progress, xpToNext };
}

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
