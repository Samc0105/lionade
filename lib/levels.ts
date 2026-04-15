// Lionade Progressive Leveling System
//
// Designed to take ~5 years at 5 hours/week to reach max level (100).
// Uses exponential growth: each level requires 5.5% more XP than the last.
//
// Early levels are fast (keep new users hooked), late levels are a grind
// (like Halo Inheritor, Clash Royale Champion, or CoD Prestige).
//
// Formula: XP to go from level N to N+1 = floor(BASE * GROWTH^N)
//   BASE = 100, GROWTH = 1.055
//
// Milestones at 1,500 XP/week (5h/week casual player):
//   Level 10  → ~1 week       Level 50 → ~4 months
//   Level 25  → ~3.5 weeks    Level 75 → ~1.5 years
//   Level 100 → ~5 years      Total XP needed: ~383,000

const MAX_LEVEL = 100;
const BASE_XP = 100;
const GROWTH = 1.055;

// ── Level tiers (cosmetic ranks like Halo/Valorant) ─────────

export interface LevelTier {
  name: string;
  minLevel: number;
  maxLevel: number;
  color: string;
  icon: string;
}

export const LEVEL_TIERS: LevelTier[] = [
  { name: "Rookie",       minLevel: 1,  maxLevel: 10,  color: "#9CA3AF", icon: "🌱" },
  { name: "Scholar",      minLevel: 11, maxLevel: 20,  color: "#22C55E", icon: "📗" },
  { name: "Apprentice",   minLevel: 21, maxLevel: 30,  color: "#3B82F6", icon: "📘" },
  { name: "Sage",         minLevel: 31, maxLevel: 40,  color: "#8B5CF6", icon: "🔮" },
  { name: "Master",       minLevel: 41, maxLevel: 50,  color: "#F59E0B", icon: "⭐" },
  { name: "Grandmaster",  minLevel: 51, maxLevel: 60,  color: "#EF4444", icon: "🔥" },
  { name: "Legend",        minLevel: 61, maxLevel: 70,  color: "#EC4899", icon: "💎" },
  { name: "Mythic",        minLevel: 71, maxLevel: 80,  color: "#14B8A6", icon: "🌟" },
  { name: "Immortal",     minLevel: 81, maxLevel: 90,  color: "#FFD700", icon: "👑" },
  { name: "Ascendant",    minLevel: 91, maxLevel: 99,  color: "#FF6B00", icon: "🦁" },
  { name: "Lion King",    minLevel: 100, maxLevel: 100, color: "#FFD700", icon: "🦁👑" },
];

// ── XP calculations ─────────────────────────────────────────

/** XP required to go from level `n` to level `n+1` */
export function xpForNextLevel(n: number): number {
  if (n >= MAX_LEVEL) return Infinity;
  return Math.floor(BASE_XP * Math.pow(GROWTH, n));
}

/** Total cumulative XP required to reach a given level (from 0) */
export function totalXpForLevel(level: number): number {
  if (level <= 1) return 0;
  const clamped = Math.min(level, MAX_LEVEL);
  let total = 0;
  for (let n = 0; n < clamped - 1; n++) {
    total += Math.floor(BASE_XP * Math.pow(GROWTH, n));
  }
  return total;
}

/** Given total XP, return the player's current level (1-100) */
export function getLevelFromXp(totalXp: number): number {
  let level = 1;
  let remaining = totalXp;
  while (level < MAX_LEVEL) {
    const needed = xpForNextLevel(level - 1);
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }
  return level;
}

/** Full progress info for UI display */
export interface LevelProgress {
  level: number;
  tier: LevelTier;
  currentXpInLevel: number;   // XP earned toward next level
  xpNeededForNext: number;    // Total XP needed to level up
  progressPercent: number;    // 0-100
  totalXp: number;            // Raw total XP
  isMaxLevel: boolean;
}

export function getLevelProgress(totalXp: number): LevelProgress {
  const level = getLevelFromXp(totalXp);
  const xpAtCurrentLevel = totalXpForLevel(level);
  const currentXpInLevel = totalXp - xpAtCurrentLevel;
  const xpNeeded = level >= MAX_LEVEL ? 0 : xpForNextLevel(level - 1);
  const progress = level >= MAX_LEVEL ? 100 : Math.min(100, (currentXpInLevel / xpNeeded) * 100);
  const tier = getTierForLevel(level);

  return {
    level,
    tier,
    currentXpInLevel,
    xpNeededForNext: xpNeeded,
    progressPercent: Math.round(progress * 10) / 10,
    totalXp,
    isMaxLevel: level >= MAX_LEVEL,
  };
}

/** Get the tier (rank name) for a level */
export function getTierForLevel(level: number): LevelTier {
  return LEVEL_TIERS.find(t => level >= t.minLevel && level <= t.maxLevel) ?? LEVEL_TIERS[0];
}

/** Format level for display: "Lv.42" */
export function formatLevel(level: number): string {
  return `Lv.${level}`;
}

/** Compact display: "Lv.42 Master" */
export function formatLevelWithTier(level: number): string {
  const tier = getTierForLevel(level);
  return `Lv.${level} ${tier.name}`;
}
