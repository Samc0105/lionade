// Arena V2 anonymized handle generator.
//
// Deterministic handle ("Shadow Wolf 4729") from user_id so the same user
// gets the same handle across sessions. We persist the result in
// profiles.ghost_anon_handle at first consent so the handle is stable even
// if the wordlists change later.

const ADJECTIVES = [
  "Shadow", "Crimson", "Iron", "Silver", "Frost", "Ember", "Storm",
  "Phantom", "Velvet", "Onyx", "Solar", "Lunar", "Echo", "Cobalt",
  "Glass", "Quiet", "Wild", "Brave", "Sharp", "Steady", "Crystal",
  "Midnight", "Dawn", "Dusk", "Ivory", "Amber", "Jade", "Ruby",
];

const NOUNS = [
  "Wolf", "Falcon", "Tiger", "Fox", "Raven", "Lion", "Hawk", "Bear",
  "Stag", "Owl", "Lynx", "Otter", "Hare", "Cobra", "Shark", "Eel",
  "Crane", "Heron", "Mantis", "Drake", "Whale", "Panther", "Jaguar",
  "Heron", "Magpie", "Newt", "Toad", "Wren",
];

// Tiny deterministic 32-bit hash (FNV-1a). Stable across runtimes — we
// don't need cryptographic strength; we need "same input → same handle."
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Deterministic anonymized handle for a user.
 * Format: "<Adjective> <Noun> <4-digit-number>"
 * Example: "Shadow Wolf 4729"
 */
export function generateAnonHandle(userId: string): string {
  const h = fnv1a(userId);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
  const num = (h % 9000) + 1000; // 1000..9999
  return `${adj} ${noun} ${num}`;
}
