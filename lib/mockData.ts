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

export const SUBJECT_ICONS: Record<Subject, string> = {
  Math: "🧮",
  Science: "🔬",
  Languages: "🌍",
  "SAT/ACT": "📝",
  Coding: "💻",
  Finance: "💰",
  Certifications: "🏆",
};

export const SUBJECT_COLORS: Record<Subject, string> = {
  Math: "#4A90D9",
  Science: "#2ECC71",
  Languages: "#9B59B6",
  "SAT/ACT": "#E67E22",
  Coding: "#1ABC9C",
  Finance: "#FFD700",
  Certifications: "#E91E63",
};
