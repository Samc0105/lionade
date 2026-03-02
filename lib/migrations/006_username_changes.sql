-- ============================================================
-- Migration 006: Username Changes — one change per year
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS username_changes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  old_username TEXT NOT NULL,
  new_username TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_username_changes_user ON username_changes(user_id);

-- RLS
ALTER TABLE username_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "username_changes_owner_read" ON username_changes;
CREATE POLICY "username_changes_owner_read" ON username_changes FOR SELECT USING (auth.uid() = user_id);

-- Ensure profiles.username has a unique constraint (may already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_username_key'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
  END IF;
END $$;

SELECT 'username_changes table ready' AS status;
