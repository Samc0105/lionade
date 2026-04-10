-- Migration 017: Refactor ninny_chat_messages to be material-scoped
--
-- Original migration 015 tied chat messages to a play session via session_id.
-- Phase 3 needs chat to work BEFORE the user plays any modes — chat is a
-- property of the material itself, not a session.
--
-- This migration:
-- 1. Drops NOT NULL on session_id (kept for future analytics if a chat
--    happens in the context of a specific play session)
-- 2. Adds material_id NOT NULL referencing ninny_materials
-- 3. Adds an index for fast history lookup by material
--
-- Safe to run on the existing schema — the chat table is currently empty
-- in production (no chat feature shipped yet).

ALTER TABLE ninny_chat_messages
  ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE ninny_chat_messages
  ADD COLUMN IF NOT EXISTS material_id UUID
    REFERENCES ninny_materials(id) ON DELETE CASCADE;

-- Set NOT NULL — table is empty so this won't fail
ALTER TABLE ninny_chat_messages
  ALTER COLUMN material_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ninny_chat_material
  ON ninny_chat_messages(material_id, created_at);
