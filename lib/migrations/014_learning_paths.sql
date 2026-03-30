-- Learning Paths: Duolingo-style staged learning per subject
-- Run this migration BEFORE the seed script

CREATE TABLE IF NOT EXISTS learning_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  stage_number INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  stage_description TEXT NOT NULL,
  lesson_text TEXT,
  total_stages INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subject, stage_number)
);

CREATE TABLE IF NOT EXISTS user_stage_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL DEFAULT 0 CHECK (stars BETWEEN 0 AND 3),
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  best_score INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, stage_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_learning_paths_subject ON learning_paths(subject, stage_number);
CREATE INDEX IF NOT EXISTS idx_user_stage_progress_user ON user_stage_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stage_progress_stage ON user_stage_progress(stage_id);

-- RLS
ALTER TABLE learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stage_progress ENABLE ROW LEVEL SECURITY;

-- Everyone can read learning paths
CREATE POLICY "learning_paths_select" ON learning_paths FOR SELECT USING (true);

-- Users can read/write their own progress
CREATE POLICY "user_stage_progress_select" ON user_stage_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_stage_progress_insert" ON user_stage_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_stage_progress_update" ON user_stage_progress FOR UPDATE USING (auth.uid() = user_id);
