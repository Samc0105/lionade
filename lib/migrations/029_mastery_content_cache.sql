-- Migration 029: Mastery Mode — shared content cache
--
-- Every teaching panel and every question Ninny generates is keyed by
-- `content_hash` (the normalized hash of subtopic name within its parent exam).
-- Two users studying the same thing share the same generated content.
--
-- Cost model: first user on a given hash pays the Sonnet generation cost,
-- every user after that reads from cache for free. Popular topics ("Calculus 1
-- derivatives", "AWS Security Specialty — IAM") amortize to ~zero.

CREATE TABLE IF NOT EXISTS mastery_teaching_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  content_hash TEXT NOT NULL,           -- matches mastery_subtopics.content_hash
  panel_order INTEGER NOT NULL,         -- 1..N, Ninny generates an ordered micro-curriculum

  title TEXT NOT NULL,                  -- <= 80 chars
  tldr TEXT NOT NULL,                   -- <= 200 chars
  bullets JSONB NOT NULL,               -- string[], 4-6 items
  mnemonic TEXT,                        -- optional
  common_pitfall TEXT,                  -- optional

  -- Provenance / cost telemetry
  model_used TEXT NOT NULL,
  generation_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  generated_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Quality controls (future: curation pipeline can flag/retire panels)
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'retired')),
  times_served INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_hash, panel_order)
);

CREATE INDEX IF NOT EXISTS idx_mtp_content
  ON mastery_teaching_panels(content_hash, panel_order)
  WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS mastery_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  content_hash TEXT NOT NULL,           -- matches mastery_subtopics.content_hash
  question_hash TEXT NOT NULL,          -- md5 of normalized question text for dedup

  question TEXT NOT NULL,
  options JSONB NOT NULL,               -- [string, string, string, string]
  correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation TEXT NOT NULL,            -- cited mechanism; shown when no AI explain is spent
  difficulty TEXT NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard')),

  model_used TEXT NOT NULL,
  generation_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  generated_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Global aggregate signal — used by auto-curation to retire bad questions.
  times_shown INTEGER NOT NULL DEFAULT 0,
  times_correct INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'pending', 'retired')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_hash)
);

CREATE INDEX IF NOT EXISTS idx_mq_content_diff_status
  ON mastery_questions(content_hash, difficulty, status);

-- Service-role-only writes; reads via API only (service role bypasses RLS).
-- Content is not user-owned — no per-user policies needed.
ALTER TABLE mastery_teaching_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery_questions ENABLE ROW LEVEL SECURITY;
-- No policies = no direct client access. All reads proxied through API routes.
