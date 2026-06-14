/**
 * Account-deletion storage purge (server-only).
 *
 * Supabase `auth.admin.deleteUser` cascades Postgres FK rows but does NOT touch
 * Supabase Storage objects — there is no auth.users -> storage.objects cascade.
 * So without this, a deleted user's uploaded files (note photos, syllabus PDFs)
 * are orphaned in Storage forever: a GDPR Art. 17 (right-to-erasure) gap.
 *
 * The reaper (app/api/cron/reap-pending-deletions) calls this BEFORE deleteUser,
 * so we can still enumerate the owner-folder prefix, and FAIL-CLOSED: if this
 * throws, the caller must skip the hard-delete so the account stays scheduled
 * and retries (never leave PII with no pointer to it).
 */

import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * Every private bucket keyed by an owner-folder of `<userId>/...`. note-images
 * is flat (`<uid>/<uuid>.jpg`); class-syllabi nests (`<uid>/<classId>/<uuid>.pdf`).
 * The recursive lister handles both depths.
 */
const USER_UPLOAD_BUCKETS = ["note-images", "class-syllabi"] as const;

const LIST_PAGE = 100;

/**
 * Recursively collect every object key under `prefix` in a bucket. Supabase
 * `list()` returns a single level; folder placeholders come back with a null
 * `id`, so we recurse into those. Paginated so a user with many files is fully
 * enumerated.
 */
async function listAllKeys(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);

    const entries = data ?? [];
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folder placeholders come back with a null id at RUNTIME, but
      // @supabase/storage-js types FileObject.id as non-nullable `string`. Cast
      // so the null branch stays honest and an SDK type change that drops the
      // null case surfaces at compile time, instead of silently turning this
      // recursion into dead code (which would re-orphan nested class-syllabi
      // objects and reopen the erasure leak this fix closes).
      const id = (entry as { id: string | null }).id;
      if (id === null) {
        keys.push(...(await listAllKeys(bucket, path)));
      } else {
        keys.push(path);
      }
    }

    if (entries.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }

  return keys;
}

/**
 * Hard-delete every Supabase Storage object a user owns across the user-upload
 * buckets. Returns the number removed. Throws on any list/remove failure so the
 * caller can fail closed. Idempotent: re-running after a partial failure simply
 * removes whatever remains.
 */
export async function purgeUserSupabaseStorage(userId: string): Promise<number> {
  let removed = 0;

  for (const bucket of USER_UPLOAD_BUCKETS) {
    const keys = await listAllKeys(bucket, userId);
    // Supabase remove() accepts up to 1000 paths per call; batch defensively.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);
      if (error) throw new Error(`remove ${bucket}: ${error.message}`);
      removed += batch.length;
    }
  }

  return removed;
}
