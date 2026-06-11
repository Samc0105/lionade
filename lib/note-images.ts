/**
 * Note photos — token parse/strip + signed-URL layer (web).
 *
 * Mirrors `lionade-ios/lib/note-images.ts`. The iOS app embeds photos in
 * class notes as standard markdown image tokens appended to the plain-text
 * `class_notes.body`:
 *
 *   ![photo](note-images/<userId>/<uuid>.jpg)
 *
 * The URL part is the bucket name + object key in the private `note-images`
 * Supabase Storage bucket (owner-folder RLS, same pattern as class-syllabi).
 * Renderers parse the token out of the body and resolve a short-lived signed
 * URL at display time — nothing in the body ever expires or leaks a public
 * URL, and the raw token must never reach the user's eyes.
 *
 * The parse/strip helpers are pure (safe to import from API routes); the
 * supabase client is lazy-imported only when a signed URL is actually
 * requested, so server-side strip callers never boot the browser client.
 */

export const NOTE_IMAGES_BUCKET = "note-images";

// ── Token format ─────────────────────────────────────────────────────────────

const TOKEN_RE = /!\[([^\]]*)\]\(note-images\/([^)\s]+)\)/g;

function hasToken(body: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(body);
}

export type NoteBodySegment =
  | { type: "text"; text: string }
  | { type: "image"; alt: string; objectKey: string };

/**
 * Split a note body into text + image segments, in order. Bodies with no
 * tokens come back as a single untouched text segment, so plain notes
 * render byte-identical to before.
 */
export function parseNoteBody(body: string): NoteBodySegment[] {
  if (!hasToken(body)) return [{ type: "text", text: body }];

  const segments: NoteBodySegment[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(body); m !== null; m = TOKEN_RE.exec(body)) {
    const before = body.slice(last, m.index).replace(/\n{3,}/g, "\n\n").trim();
    if (before.length > 0) segments.push({ type: "text", text: before });
    segments.push({ type: "image", alt: m[1] || "photo", objectKey: m[2] });
    last = m.index + m[0].length;
  }
  const tail = body.slice(last).replace(/\n{3,}/g, "\n\n").trim();
  if (tail.length > 0) segments.push({ type: "text", text: tail });
  return segments;
}

/**
 * Replace image tokens with a short placeholder for one-line teasers and
 * server-generated previews. Token-free bodies are returned unchanged so
 * existing previews don't shift by a byte.
 */
export function stripNoteImageTokens(body: string, placeholder = "[photo]"): string {
  if (!hasToken(body)) return body;
  TOKEN_RE.lastIndex = 0;
  return body.replace(TOKEN_RE, placeholder).replace(/\s{2,}/g, " ").trim();
}

// ── Signed URL cache ─────────────────────────────────────────────────────────

const SIGNED_TTL_SECONDS = 3600;
/** Refresh when under 5 minutes of validity remain. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Resolve a signed URL for an object in the note-images bucket. Cached
 * in-memory for the TTL so a notes list never storms the storage API.
 * RLS (owner-folder select) authorizes the signing server-side.
 */
export async function getSignedNoteImageUrl(objectKey: string): Promise<string> {
  const hit = signedUrlCache.get(objectKey);
  if (hit && hit.expiresAt - Date.now() > REFRESH_MARGIN_MS) return hit.url;

  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase.storage
    .from(NOTE_IMAGES_BUCKET)
    .createSignedUrl(objectKey, SIGNED_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Couldn't load photo.");
  }
  signedUrlCache.set(objectKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}
