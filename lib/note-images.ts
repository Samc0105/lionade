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

// Matches BOTH the legacy Supabase token (`note-images/<key>`) and the new
// S3-pilot token (`user-uploads/<uid>/<uuid>.<ext>`). Group 1 = alt text,
// group 2 = backend prefix, group 3 = the rest of the key. `objectKey` carries
// the FULL token (prefix included) so the resolver routes to the right backend.
const TOKEN_RE = /!\[([^\]]*)\]\((note-images|user-uploads)\/([^)\s]+)\)/g;

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
    // objectKey is the FULL token (prefix + key), e.g. `note-images/<uid>/x.jpg`
    // or `user-uploads/<uid>/x.jpg`, so getSignedNoteImageUrl can route it.
    segments.push({ type: "image", alt: m[1] || "photo", objectKey: `${m[2]}/${m[3]}` });
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
 * Resolve a signed view URL for a note photo, routing by token prefix. Cached
 * in-memory (keyed by the full token, which embeds the userId) for the TTL so a
 * notes list never storms the backend.
 *
 *   `note-images/<key>`     -> legacy Supabase Storage. Signed via the
 *                              RLS-respecting anon client; owner-folder RLS is
 *                              the boundary (never swap to the admin client).
 *   `user-uploads/<key>`    -> new S3 pilot. Our API mints a presigned GET after
 *                              an ownership check (the client holds no AWS creds).
 */
export async function getSignedNoteImageUrl(objectKey: string): Promise<string> {
  const hit = signedUrlCache.get(objectKey);
  if (hit && hit.expiresAt - Date.now() > REFRESH_MARGIN_MS) return hit.url;

  let url: string;

  if (objectKey.startsWith("user-uploads/")) {
    // S3-hosted photo (pilot). The server checks ownership before signing.
    const { apiGet } = await import("@/lib/api-client");
    const res = await apiGet<{ url: string }>(
      `/api/note-images/sign-read?key=${encodeURIComponent(objectKey)}`,
    );
    if (!res.ok || !res.data?.url) {
      throw new Error(res.error ?? "Couldn't load photo.");
    }
    url = res.data.url;
  } else {
    // Legacy Supabase-hosted photo. Strip the bucket prefix the token carries
    // and sign via the RLS client (owner-folder RLS authorizes server-side).
    const supabaseKey = objectKey.replace(/^note-images\//, "");
    // Defense-in-depth: the token comes from user-editable class_notes.body, so
    // reject anything that isn't the owner-foldered `<uuid>/<file>.<img>` shape
    // before it reaches storage. RLS is still the real boundary; this refuses
    // traversal/garbage early and mirrors the strict KEY_RE in lib/s3.ts.
    if (!/^[0-9a-f-]{36}\/[^/]+\.(jpe?g|png|webp|heic)$/i.test(supabaseKey)) {
      throw new Error("Couldn't load photo.");
    }
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase.storage
      .from(NOTE_IMAGES_BUCKET)
      .createSignedUrl(supabaseKey, SIGNED_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "Couldn't load photo.");
    }
    url = data.signedUrl;
  }

  signedUrlCache.set(objectKey, {
    url,
    expiresAt: Date.now() + SIGNED_TTL_SECONDS * 1000,
  });
  return url;
}
