-- Migration 028: Mastery Mode — user-defined exam targets
--
-- A user_exam is the thing a user says they want to master ("AWS Security
-- Specialty", "Calculus 1 midterm covering derivatives/integrals/limits", …).
-- We do NOT pre-seed a fixed exam list — the user can type anything. Ninny
-- parses their free-form description into a list of weighted subtopics (stored
-- as JSONB on this row + linked rows in mastery_subtopics).
--
-- `topic_hash` is the normalized SHA-1 of the parsed title, used as the key
-- for shared cross-user content cache (mastery_content). Two users studying
-- the exact same topic hit the same hash and share the generated questions
-- and teaching panels.

CREATE TABLE IF NOT EXISTS user_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  raw_input TEXT NOT NULL,              -- what the user typed / pasted
  title TEXT NOT NULL,                  -- Ninny-cleaned title, used for display
  topic_hash TEXT NOT NULL,             -- normalized hash — shared-cache key
  scope TEXT NOT NULL DEFAULT 'specific' CHECK (scope IN ('specific', 'broad')),
  parse_model TEXT,                     -- which Claude model parsed this

  target_date DATE,                     -- optional exam date

  -- Ready-to-pass threshold (we ship 0.80 to give students safety margin over a
  -- typical 0.70 real-world pass mark). Per-row so we can tune without migrations.
  ready_threshold REAL NOT NULL DEFAULT 0.80,

  -- 100% mastery bar maps to BKT 0.95 so it's reachable.
  mastery_bkt_target REAL NOT NULL DEFAULT 0.95,

  -- Aggregate "Time to master" across every session on this exam.
  total_active_seconds INTEGER NOT NULL DEFAULT 0,

  -- Set the first time the weighted aggregate crosses mastery_bkt_target.
  reached_mastery_at TIMESTAMPTZ,

  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_exams_user_active
  ON user_exams(user_id, archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_exams_topic_hash
  ON user_exams(topic_hash);

-- Ninny-parsed subtopics. One row per subtopic per user_exam.
-- Weights sum to 1.0 within a single user_exam (enforced app-side).
CREATE TABLE IF NOT EXISTS mastery_subtopics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_exam_id UUID NOT NULL REFERENCES user_exams(id) ON DELETE CASCADE,

  slug TEXT NOT NULL,                   -- 'iam', 'kms-grants' — stable within an exam
  name TEXT NOT NULL,                   -- 'Identity & Access Management'
  weight REAL NOT NULL,                 -- 0..1, all subtopics sum to ~1.0
  display_order INTEGER NOT NULL,

  -- Content hash for this specific subtopic inside its exam — the cross-user
  -- shared-cache key for teaching panels + questions. Derived from
  -- normalize(exam_title + subtopic_name).
  content_hash TEXT NOT NULL,

  short_summary TEXT,                   -- one-liner shown in the side rail

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_exam_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_mastery_subtopics_exam
  ON mastery_subtopics(user_exam_id, display_order);
CREATE INDEX IF NOT EXISTS idx_mastery_subtopics_content_hash
  ON mastery_subtopics(content_hash);

-- RLS — user owns their own exams + subtopics; all writes are server-side
-- via supabaseAdmin, so we only expose SELECT to the owner.
ALTER TABLE user_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery_subtopics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_exams_select_own"
  ON user_exams FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "mastery_subtopics_select_own"
  ON mastery_subtopics FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_exams
      WHERE user_exams.id = mastery_subtopics.user_exam_id
        AND user_exams.user_id = auth.uid()
    )
  );

-- Touch updated_at on any write
CREATE OR REPLACE FUNCTION touch_user_exams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_user_exams ON user_exams;
CREATE TRIGGER trg_touch_user_exams
  BEFORE UPDATE ON user_exams
  FOR EACH ROW EXECUTE FUNCTION touch_user_exams_updated_at();
