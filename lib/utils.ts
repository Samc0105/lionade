export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(" ");
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function getRarityColor(rarity: string): string {
  switch (rarity) {
    case "common": return "#9CA3AF";
    case "rare": return "#4A90D9";
    case "epic": return "#9B59B6";
    case "legendary": return "#FFD700";
    default: return "#9CA3AF";
  }
}

export function getRarityGlow(rarity: string): string {
  switch (rarity) {
    case "common": return "shadow-gray-500/30";
    case "rare": return "shadow-electric/50";
    case "epic": return "shadow-purple-500/50";
    case "legendary": return "shadow-gold/50";
    default: return "shadow-gray-500/30";
  }
}
