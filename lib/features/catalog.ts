// Pure feature catalog for the maintenance / feature-flag system.
//
// HARD CONSTRAINT: this module must be safe in client, server, and edge runtimes.
// It therefore has ZERO imports (no node, no supabase, no react).
//
// Audit verb for flag changes is `feature_flag_change` (written by the admin
// endpoint, not here). A key with no DB row is treated as `live` (safe default).
//
// Recovery surfaces are excluded from this catalog BY CONSTRUCTION: /admin/*,
// /login, /signup, /onboarding, /onboard/*, /settings/*, auth / account /
// quiz-core APIs, the Navbar, and the feature-flag system itself can never be
// gated, because no node exists for them here.

export interface FeatureNode {
  key: string;
  label: string;
  parentKey: string | null;
  description?: string;
}

export const FEATURE_CATALOG: FeatureNode[] = [
  { key: "site", label: "Whole site", parentKey: null },

  { key: "dashboard", label: "Dashboard", parentKey: null },
  { key: "dashboard.daily_bet", label: "Daily Bet card", parentKey: "dashboard" },
  { key: "dashboard.missions", label: "Missions card", parentKey: "dashboard" },
  { key: "dashboard.bounties", label: "Bounties card", parentKey: "dashboard" },

  { key: "learn", label: "Learn hub", parentKey: null },
  { key: "social", label: "Social hub", parentKey: null },
  { key: "leaderboard", label: "Leaderboard", parentKey: null },

  { key: "shop", label: "Shop (Lion's Den)", parentKey: null },
  { key: "shop.daily_spin", label: "Daily Spin", parentKey: "shop" },
  { key: "shop.fang_iap", label: "Fang packs (IAP)", parentKey: "shop" },

  { key: "academia", label: "Academia", parentKey: null },

  { key: "games", label: "Arcade", parentKey: null },
  { key: "games.roardle", label: "Roardle", parentKey: "games" },
  { key: "games.flashcards", label: "Flashcards", parentKey: "games" },
  { key: "games.timeline", label: "Timeline Drop", parentKey: "games" },
  { key: "games.pardy", label: "Pardy", parentKey: "games" },
  { key: "games.party", label: "Lionade Party", parentKey: "games" },
  { key: "games.party.sketch", label: "Sketch", parentKey: "games.party" },
  { key: "games.party.bluff", label: "Bluff", parentKey: "games.party" },
  { key: "games.party.pokerface", label: "Poker Face", parentKey: "games.party" },
  { key: "games.party.trivia", label: "Trivia", parentKey: "games.party" },

  { key: "compete", label: "Compete hub", parentKey: null },
  { key: "compete.blitz", label: "Blitz", parentKey: "compete" },
  { key: "compete.duel", label: "Quiz Duel", parentKey: "compete" },
  { key: "compete.arena", label: "Competitive Arena", parentKey: "compete" },
  { key: "compete.arena.sabotage", label: "Sabotage", parentKey: "compete.arena" },
  { key: "compete.arena.zoom", label: "Zoom Reveal", parentKey: "compete.arena" },
  { key: "compete.arena.spectrum", label: "Spectrum", parentKey: "compete.arena" },
  { key: "compete.arena.pin", label: "Map Pin", parentKey: "compete.arena" },
];

const FEATURE_BY_KEY: Record<string, FeatureNode> = FEATURE_CATALOG.reduce(
  (acc, node) => {
    acc[node.key] = node;
    return acc;
  },
  {} as Record<string, FeatureNode>,
);

/**
 * Pure dot-path walk of a key's ancestors, nearest first.
 * "games.party.sketch" -> ["games.party", "games"].
 * NOT catalog-dependent: an unknown key still resolves its dot ancestors.
 */
export function ancestorsOf(key: string): string[] {
  const ancestors: string[] = [];
  let idx = key.lastIndexOf(".");
  while (idx !== -1) {
    key = key.slice(0, idx);
    ancestors.push(key);
    idx = key.lastIndexOf(".");
  }
  return ancestors;
}

/**
 * The full maintenance chain for a key: the key itself followed by every
 * dot-path ancestor, nearest first. [key, ...ancestorsOf(key)].
 */
export function featureChain(key: string): string[] {
  return [key, ...ancestorsOf(key)];
}

/**
 * Look up a catalog node by key. Returns undefined for unknown keys.
 */
export function getFeature(key: string): FeatureNode | undefined {
  return FEATURE_BY_KEY[key];
}
