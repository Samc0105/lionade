/**
 * S3 helpers for the note-images upload pilot (server-only).
 *
 * Implements the spec in docs/specs/note-images-s3-pilot.md with the security
 * hardening from the adversarial review:
 *   - object KEY == public TOKEN (prefix `user-uploads/<uid>/...`), no remap
 *   - server-chosen key from the JWT userId (client can never pick the prefix)
 *   - presigned POST (not PUT) so size + content-type are policy-enforced
 *   - Content-Disposition: attachment so the object never renders same-origin
 *   - read ownership checked by strict-regex segment EQUALITY (not startsWith)
 *   - two credential sets: request-path (put/get) vs reaper (list/delete)
 *
 * DORMANT-SAFE: every entry point is gated on isS3Configured()/isS3PurgeConfigured().
 * Until the bucket + IAM keys exist (a manual `terraform apply` + Vercel env),
 * the presign routes return 503 and the purge is a no-op — so this code ships
 * safely with no live effect.
 */

import { randomUUID } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost, type PresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const BUCKET = process.env.USER_UPLOADS_BUCKET ?? "";

export const UPLOAD_PREFIX = "user-uploads";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, matches the Supabase bucket limit
const UPLOAD_TTL_SECONDS = 300; // client uploads immediately after presign
const READ_TTL_SECONDS = 3600; // matches the resolver's 1h signed-URL cache

// Allowed upload types -> file extension. HEIC is intentionally excluded (weak
// browser display + future OCR); iOS exports jpg from the picker.
const ALLOWED_TYPES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

/** Extension for an allowed content type, or null if unsupported. */
export function extForContentType(contentType: string): string | null {
  return ALLOWED_TYPES.get(contentType) ?? null;
}

/** True only when the request-path S3 credentials + bucket are configured. */
export function isS3Configured(): boolean {
  return Boolean(
    BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
  );
}

/** True only when the separate reaper (list/delete) credentials are configured. */
export function isS3PurgeConfigured(): boolean {
  return Boolean(
    BUCKET &&
      process.env.UPLOADS_REAPER_ACCESS_KEY_ID &&
      process.env.UPLOADS_REAPER_SECRET_ACCESS_KEY,
  );
}

// ── clients (two principals, least-privilege per the IAM split) ──────────────

let _requestClient: S3Client | null = null;
/** Request-path client: PutObject + GetObject only (keys from default env). */
function requestS3(): S3Client {
  if (!_requestClient) _requestClient = new S3Client({ region: REGION });
  return _requestClient;
}

let _reaperClient: S3Client | null = null;
/** Reaper client: ListBucket + DeleteObject, distinct creds, used only by the cron. */
function reaperS3(): S3Client {
  if (!_reaperClient) {
    _reaperClient = new S3Client({
      region: REGION,
      credentials: {
        accessKeyId: process.env.UPLOADS_REAPER_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.UPLOADS_REAPER_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return _reaperClient;
}

// ── upload ───────────────────────────────────────────────────────────────────

/**
 * Mint a presigned POST for a note-image upload. The key is server-chosen from
 * the authenticated userId, so the client can never write outside its own
 * prefix. Returns the POST target + the token to embed in class_notes.body
 * (token == key, no remap).
 */
export async function presignNoteImageUpload(
  userId: string,
  contentType: string,
): Promise<{ url: string; fields: Record<string, string>; token: string } | null> {
  const ext = extForContentType(contentType);
  if (!ext) return null;

  const key = `${UPLOAD_PREFIX}/${userId}/${randomUUID()}.${ext}`;

  const post: PresignedPost = await createPresignedPost(requestS3(), {
    Bucket: BUCKET,
    Key: key, // literal key — NEVER a ["starts-with", "$key", ...] condition
    Conditions: [
      ["content-length-range", 1, MAX_BYTES],
      ["eq", "$Content-Type", contentType],
      ["eq", "$Content-Disposition", "attachment"],
    ],
    Fields: {
      "Content-Type": contentType,
      "Content-Disposition": "attachment",
    },
    Expires: UPLOAD_TTL_SECONDS,
  });

  return { url: post.url, fields: post.fields, token: key };
}

// ── read ───────────────────────────────────────────────────────────────────

// Strict shape: user-uploads/<uuid>/<uuid>.<ext>. The first uuid is the owner.
const KEY_RE =
  /^user-uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

/**
 * Ownership check by EQUALITY (not startsWith): the key must match the strict
 * shape AND its owner segment must equal the caller. Rejects traversal/control
 * chars implicitly (the regex is anchored and allows only hex/uuid + ext).
 * THIS is the security boundary for reads, not the select-own notes table.
 */
export function keyOwnedBy(key: string, userId: string): boolean {
  const m = KEY_RE.exec(key);
  return m !== null && m[1].toLowerCase() === userId.toLowerCase();
}

/** Presigned GET for a note-image. Caller MUST have passed keyOwnedBy first. */
export async function presignNoteImageRead(key: string): Promise<string> {
  return getSignedUrl(
    requestS3(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: READ_TTL_SECONDS },
  );
}

// ── account-deletion purge (reaper) ──────────────────────────────────────────

/**
 * Delete every S3 object under user-uploads/<userId>/. No-op (skipped) when the
 * reaper credentials aren't configured, so the account reaper never blocks on a
 * dormant pilot. Throws only on a real S3 error WHEN configured, so the reaper
 * can fail closed. Paginates the full prefix.
 */
export async function purgeUserS3Uploads(
  userId: string,
): Promise<{ removed: number; skipped: boolean }> {
  if (!isS3PurgeConfigured()) {
    // Half-configured trap: if the WRITE path is live (so objects may already
    // exist in S3) but the reaper delete creds are missing, we CANNOT purge.
    // Fail CLOSED by throwing so the reaper's try/catch skips the deleteUser
    // cascade (the account stays scheduled and retries once the reaper creds
    // land) rather than orphaning S3 PII with no pointer. Only a TRULY dormant
    // pilot (write path also unconfigured) may safely no-op past the purge.
    if (isS3Configured()) {
      throw new Error(
        "S3 write path configured but reaper credentials missing: refusing to cascade-delete and orphan S3 objects",
      );
    }
    return { removed: 0, skipped: true };
  }

  const client = reaperS3();
  const prefix = `${UPLOAD_PREFIX}/${userId}/`;
  let removed = 0;
  let continuationToken: string | undefined;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k))
      .map((Key) => ({ Key }));

    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
      removed += objects.length;
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  return { removed, skipped: false };
}
