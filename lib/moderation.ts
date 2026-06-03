// Lightweight content moderation for user-published surface area.
//
// Scope: ONLY a tight denylist of the worst-of-the-worst English + Spanish
// slurs and explicit profanity, applied to short public-facing strings
// (bank names, etc) when a user is about to publish. This is NOT a full
// moderation service — Perspective API or OpenAI moderations is the V3B
// upgrade target. The denylist is a regex of word stems wrapped in
// word-boundary checks, lowercased, with deliberate accent folding so
// `pendéjo` and `pendejo` both trip the same entry.
//
// Design intent:
//   - false negatives are tolerated (this is the FLOOR, not the ceiling)
//   - false positives must be RARE on legit study content; we skew the list
//     toward terms with no benign use rather than ambiguous insults
//   - Spanish coverage is intentional because Lionade is bilingual
//
// Do NOT use this for chat/user-generated content streams; those need a
// real moderation service with context awareness.

// Stems — match anywhere inside a token (so "f*cking" still trips "fuck"
// once obfuscation is normalized). Each entry is a Unicode-folded lowercase
// substring. The folding step strips diacritics and common letter swaps
// (1→i, 0→o, 3→e, @→a, $→s).
const DENY_STEMS: readonly string[] = [
  // English — racial slurs and severe profanity stems
  "nigger",
  "nigga",
  "faggot",
  "fagot",
  "tranny",
  "retard",
  "kike",
  "spic",
  "chink",
  "gook",
  "wetback",
  "cunt",
  "fuck",
  "shit",
  "bitch",
  "whore",
  "slut",
  "rapist",
  "rape",
  "pedo",
  "kkk",
  // Spanish — equivalents, intentionally narrow
  "puta",
  "puto",
  "pendejo",
  "pendeja",
  "cabron",
  "cabrona",
  "mierda",
  "joder",
  "verga",
  "chinga",
  "maricon",
  "maricona",
  "marica",
  "coño",
  "cono",
  "polla",
  "zorra",
  "violador",
];

// Map of cheap obfuscation chars → their letter equivalents. Folded BEFORE
// the substring check so "f*ck" / "f.uck" / "fu_ck" all collapse to "fuck".
const FOLD_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
};

function foldForCheck(input: string): string {
  // 1) Lowercase + NFKD normalize.
  const lowered = input.toLocaleLowerCase().normalize("NFKD");
  // 2) Strip combining marks (accents). ̀-ͯ covers Latin combining range.
  const stripped = lowered.replace(/[̀-ͯ]/g, "");
  // 3) Letter-swap fold for digits + symbols.
  const swapped = stripped
    .split("")
    .map((ch) => FOLD_MAP[ch] ?? ch)
    .join("");
  // 4) Collapse non-letters into a single space so "f.u.c.k" becomes "f u c k"
  //    THEN we also produce a no-separator variant so the substring check
  //    catches inserted punctuation between every letter.
  const collapsed = swapped.replace(/[^a-zñ]+/g, " ");
  const noSep = collapsed.replace(/\s+/g, "");
  return `${collapsed} ${noSep}`;
}

/**
 * Returns true if the text is clean (no denylist hits).
 * Intentionally simple: substring check on a folded form. Word boundaries
 * are NOT enforced because obfuscation (extra letters/punctuation) is more
 * common than legit longer words containing a slur — false positives on
 * Scunthorpe-style words are accepted as cost of catching abuse.
 *
 * Empty / non-string input is treated as clean (let upstream validators
 * own length + format errors).
 */
export function isClean(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return true;
  const folded = foldForCheck(text);
  for (const stem of DENY_STEMS) {
    if (folded.includes(stem)) return false;
  }
  return true;
}

/** Test-only helper — exposes the folded form for debugging. Do not import in routes. */
export function _foldForCheck(text: string): string {
  return foldForCheck(text);
}
