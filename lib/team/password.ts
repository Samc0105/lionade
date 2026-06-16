// Temporary-password generation for team-member provisioning (server-only).
//
// WHY crypto.randomBytes (CSPRNG) is MANDATORY, never Math.random():
//
//   This function mints CREDENTIAL MATERIAL — the one-time password a brand-new
//   @getlionade.com team member uses to log into a real Lionade Supabase account.
//   Until they complete `must_change_password`, this string is the only thing
//   standing between an attacker and that account.
//
//   Math.random() (and every other non-cryptographic PRNG) is *seeded* and
//   *deterministic*: its output stream is a pure function of internal state that
//   leaks through prior outputs. V8's xorshift128+ is fully reversible — given a
//   handful of observed values an attacker can recover the seed and predict every
//   past and future draw. If we generated passwords that way, an attacker who saw
//   any other Math.random()-derived value from the same process (or simply
//   brute-forced the limited seed space) could reproduce the exact password we
//   issued. crypto.randomBytes() draws from the OS CSPRNG (getrandom/CryptoGen),
//   which is unpredictable and non-reversible by design. For anything an attacker
//   would want to guess — passwords, tokens, reset codes — a CSPRNG is the floor.
//
// We also use rejection sampling (not `% alphabet.length`) so every character is
// uniformly distributed: naive modulo on a 256-value byte biases the first
// `256 % len` characters of the alphabet, shrinking effective entropy.

import { randomBytes } from "crypto";

// Distinct, unambiguous character classes. Each is sampled at least once so the
// result always satisfies a "upper + lower + digit + symbol" complexity policy.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O (visual ambiguity)
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const DIGITS = "23456789"; // no 0/1
const SYMBOLS = "!@#$%^&*()-_=+[]{}";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

const PASSWORD_LENGTH = 20;

/**
 * Uniform random integer in [0, max) using rejection sampling over CSPRNG bytes.
 * Discards bytes in the biased tail so the distribution stays flat.
 */
function secureRandomInt(max: number): number {
  if (max <= 0 || max > 256) {
    throw new Error("secureRandomInt: max must be in (0, 256]");
  }
  const limit = Math.floor(256 / max) * max; // largest multiple of max <= 256
  for (;;) {
    const byte = randomBytes(1)[0];
    if (byte < limit) return byte % max;
    // else: byte fell in the biased tail — draw again.
  }
}

/** Pick one uniformly random character from `set`. */
function pickFrom(set: string): string {
  return set.charAt(secureRandomInt(set.length));
}

/**
 * Fisher–Yates shuffle driven by the CSPRNG so the guaranteed-class characters
 * aren't pinned to the front of the string.
 */
function secureShuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/**
 * Generate a 20-character temporary password with at least one upper, lower,
 * digit, and symbol. The caller hands this to Supabase as the initial password
 * and sets must_change_password=true; it is shown to the admin ONCE and must
 * NEVER be persisted to logs, audit metadata, or any response body beyond the
 * single provisioning response.
 */
export function generateTempPassword(): string {
  // Guarantee one of each required class, then fill the remainder from the full
  // alphabet, then shuffle so positions are unpredictable.
  const required = [pickFrom(UPPER), pickFrom(LOWER), pickFrom(DIGITS), pickFrom(SYMBOLS)];
  const remaining: string[] = [];
  for (let i = required.length; i < PASSWORD_LENGTH; i++) {
    remaining.push(pickFrom(ALL));
  }
  return secureShuffle([...required, ...remaining]).join("");
}
