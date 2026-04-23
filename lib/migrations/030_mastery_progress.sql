-- Migration 030: Mastery Mode — per-user, per-subtopic BKT state
--
-- One row per (user, subtopic). Updated after every answer. Drives the
-- slow-fill progress bar and the pPass aggregate.
--
-- BKT state (see lib/mastery.ts for the math):
--   p_mastery  — posterior probability user has mastered this subtopic
--   attempts / correct — raw counters (used for the display floor)
--   current_streak — consecutive correct, resets on wrong
--
-- display_pct is the smoothed/dampened bar value (0..100) we show to the
-- user. We store it so reloads don't snap the bar backward on a new session.

CREATE TABLE IF NOT EXISTS mastery_progress (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subtopic_id UUID NOT NULL REFERENCES mastery_subtopics(id) ON DELETE CASCADE,

  p_mastery REAL NOT NULL DEFAULT 0.10,    -- BKT prior; updated on every answer
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,

  display_pct REAL NOT NULL DEFAULT 0,     -- 0..100 smoothed bar value

  last_seen_at TIMESTAMPTZ,
  last_taught_at TIMESTAMPTZ,

  total_active_seconds INTEGER NOT NULL DEFAULT 0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, subtopic_id)
);

CREATE INDEX IF NOT EXISTS idx_mastery_progress_user
  ON mastery_progress(user_id);

ALTER TABLE mastery_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mastery_progress_select_own"
  ON mastery_progress FOR SELECT USING (auth.uid() = user_id);
-- Writes are server-only via supabaseAdmin.
