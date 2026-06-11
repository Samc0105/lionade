-- Migration: Storage RLS for the note-images bucket (class-note photos).
--
-- The bucket itself must be created out-of-band (dashboard or storage
-- admin API) — bucket creation is not SQL DDL. Required bucket config:
--   id/name:            note-images
--   public:             false
--   file_size_limit:    10485760 (10 MB)
--   allowed_mime_types: image/jpeg, image/png, image/webp, image/heic
--
-- Mirrors migration 044 (class-syllabi): owner-folder policy so a user
-- can only touch objects under their own `${user_id}/...` prefix. Notes
-- are strictly private (class_notes RLS is select-own), so photos are
-- served exclusively via short-lived signed URLs created client-side
-- under these SELECT rights. No public read, no cross-user access.

DROP POLICY IF EXISTS "note_images_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "note_images_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "note_images_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "note_images_owner_update" ON storage.objects;

CREATE POLICY "note_images_owner_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "note_images_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "note_images_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "note_images_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
