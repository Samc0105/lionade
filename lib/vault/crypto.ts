// Credential-vault at-rest encryption (server-only).
//
// THREAT MODEL / PORTFOLIO TALKING POINT
// --------------------------------------
// The admin credential vault stores shared team secrets (third-party logins,
// API tokens, infra passwords) so they never live in a Slack message or a
// spreadsheet. Every secret is sealed with AES-256-GCM using a key that lives
// ONLY in the server environment (CREDENTIAL_ENCRYPTION_KEY), never in the
// database. The database stores only ciphertext, a per-secret random IV, and
// the GCM authentication tag.
//
// The consequence is the whole point of the feature: a full database
// compromise (leaked dump, stolen backup, a SQL-injection that reads every
// row, even a malicious admin reading rows directly through RLS) yields only
// ciphertext. Without the environment key, none of it decrypts. Decryption is
// possible exclusively inside a running server process that holds the key.
//
// GCM is AUTHENTICATED encryption: the 16-byte auth tag binds the ciphertext.
// If the ciphertext, IV, or tag is tampered with, or the wrong key is used,
// decryption FAILS LOUDLY (the GCM final() throws) rather than returning
// garbage or partial plaintext. We never return data on a tag failure.
//
// KEY MANAGEMENT
// --------------
// CREDENTIAL_ENCRYPTION_KEY is a base64-encoded 32-byte (256-bit) random key.
// Generate one with:
//
//     openssl rand -base64 32
//
// Set it in the server environment only. It is server-side crypto: it must
// NEVER be a NEXT_PUBLIC_* var and must NEVER ship in any client bundle.
// Following the rest of this codebase, the env var is read and validated at
// CALL time inside readKey(), never at module load, so importing this file can
// never crash a route. A missing or malformed key surfaces as a clear error
// only when an encrypt/decrypt is actually attempted.
//
// The key value is NEVER logged. Errors name the variable and may state its
// decoded byte length (length is not sensitive); they never include the bytes.
//
// SERVER-ONLY: never import this file in client components or pages. Only
// import it in /app/api/* route handlers and other server-only lib modules.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/** AES-256-GCM. 32-byte key, 12-byte IV (GCM recommended), 16-byte auth tag. */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Shape of a sealed secret as stored across three columns / fields. All base64. */
export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Read CREDENTIAL_ENCRYPTION_KEY at CALL time, decode it from base64, and
 * validate it is exactly 32 bytes. Throws a clear, value-free error otherwise.
 * The key bytes are NEVER logged or included in the thrown message.
 */
function readKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY not configured or not a 32-byte key");
  }
  // base64 silently tolerates malformed input, so we MUST decode then check the
  // resulting byte length rather than trusting the string length.
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    // The decoded length is safe to surface; the key bytes are NOT.
    throw new Error("CREDENTIAL_ENCRYPTION_KEY not configured or not a 32-byte key");
  }
  return key;
}

/**
 * Whether the vault is usable: the env key is present and decodes to exactly
 * 32 bytes. Never throws. Routes use this to return a clean "not configured"
 * 503 instead of letting an encrypt/decrypt blow up mid-request.
 */
export function isVaultConfigured(): boolean {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return false;
  return Buffer.from(raw, "base64").length === KEY_BYTES;
}

/**
 * Seal a plaintext secret with AES-256-GCM. A fresh random 12-byte IV is drawn
 * per call (never reused with the same key). Returns base64 ciphertext, IV, and
 * the 16-byte authentication tag (the tag is fetched only AFTER final()). The
 * IV and tag are not secret; only the key is.
 */
export function encryptSecret(plaintext: string): SealedSecret {
  const key = readKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Open a sealed secret. setAuthTag() is applied BEFORE final(); GCM verifies
 * integrity at final(). If the tag is wrong, the key is wrong, or the
 * ciphertext/IV/tag was tampered with, final() THROWS and we let it propagate
 * unchanged so the caller can catch it and return a single generic error. The
 * underlying crypto error is intentionally NOT reshaped here and must NEVER be
 * echoed to a client or a log by the caller. No partial plaintext is ever
 * returned on failure.
 */
export function decryptSecret(parts: SealedSecret): string {
  const key = readKey();
  const iv = Buffer.from(parts.iv, "base64");
  const authTag = Buffer.from(parts.authTag, "base64");
  const ciphertext = Buffer.from(parts.ciphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // final() throws on a failed tag check; allowed to propagate (caller catches).
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
