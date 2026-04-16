-- Migration 023: Self-growing question bank
--
-- Every Ninny-generated MCQ question is silently saved here.
-- Performance data (times_shown, times_correct) is tracked as users answer.
-- Questions auto-promote to "approved" once they hit quality thresholds.
-- Approved questions feed into Blitz, quizzes, and arena.

CREATE TABLE IF NOT EXISTS question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Question content
  question TEXT NOT NULL,
  options JSONB NOT NULL,            -- ["Option A", "Option B", "Option C", "Option D"]
  correct_index INTEGER NOT NULL,    -- 0-based index into options array
  explanation TEXT,

  -- Classification
  subject TEXT NOT NULL,             -- science, math, history, social, cs, english, etc.
  topic TEXT,                        -- biology, algebra, world-war-2, etc.
  difficulty TEXT NOT NULL DEFAULT 'medium',  -- easy, medium, hard
  original_difficulty TEXT,          -- what the user selected when generating

  -- Source tracking
  source_material_id UUID REFERENCES ninny_materials(id) ON DELETE SET NULL,
  generated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Performance metrics
  times_shown INTEGER NOT NULL DEFAULT 0,
  times_correct INTEGER NOT NULL DEFAULT 0,
  success_rate REAL,                 -- computed: times_correct / times_shown (NULL if never shown)

  -- Curation pipeline
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate')),
  rejection_reason TEXT,             -- why it was rejected (off-topic, wrong answer, etc.)

  -- Dedup
  question_hash TEXT,                -- lowercase trimmed hash for duplicate detection

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_qb_subject_status ON question_bank(subject, status, difficulty);
CREATE INDEX IF NOT EXISTS idx_qb_status ON question_bank(status);
CREATE INDEX IF NOT EXISTS idx_qb_hash ON question_bank(question_hash);
CREATE INDEX IF NOT EXISTS idx_qb_performance ON question_bank(status, times_shown, success_rate);
CREATE INDEX IF NOT EXISTS idx_qb_source ON question_bank(source_material_id);

-- RLS: service role only (no client access needed)
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

-- Approved subjects that auto-promote (everything else stays pending)
-- This is referenced in application code, not enforced at DB level,
-- so we can add new subjects without a migration.
