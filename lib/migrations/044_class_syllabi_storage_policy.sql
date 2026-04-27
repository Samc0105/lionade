-- Migration 044: Storage RLS for the class-syllabi bucket.
--
-- The bucket itself must be created in the Supabase dashboard (private,
-- 5 MB, application/pdf only) — Storage bucket creation is not a SQL DDL
-- operation and can't be applied via this migration. After the bucket
-- exists, this file enforces the per-user folder ownership policy so a
-- user can only INSERT/SELECT/DELETE objects under their own
-- `${user_id}/...` prefix. Without this policy, any authed user could
-- list/download every other user's uploaded syllabus PDF.

-- Drop existing policies first so this migration is idempotent.
DROP POLICY IF EXISTS "syllabi_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "syllabi_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "syllabi_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "syllabi_owner_update" ON storage.objects;

CREATE POLICY "syllabi_owner_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'class-syllabi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "syllabi_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'class-syllabi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "syllabi_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'class-syllabi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "syllabi_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'class-syllabi'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
