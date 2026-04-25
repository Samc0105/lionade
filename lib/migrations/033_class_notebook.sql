-- Migration 033: Class Notebook system
--
-- Top-level user-owned containers ("classes") that wrap mastery targets,
-- notes, and a daily AI plan. Built on top of the existing Mastery Mode
-- infrastructure — `user_exams` gains an optional `class_id` so a class
-- can have multiple mastery targets (midterm + final), but standalone
-- exams (class_id NULL) keep working unchanged.
--
-- Three new tables, one column add. All RLS-on with service-role-only
-- writes (the API routes use supabaseAdmin) and per-user SELECT policies.

-- ── Classes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  name TEXT NOT NULL,                  -- "Calculus 2", "AWS Sec Specialty"
  short_code TEXT,                     -- "MATH 2002", "SCS-C02"
  professor TEXT,
  term TEXT,                           -- "Spring 2026" — null for self-study
  color TEXT NOT NULL DEFAULT '#FFD700',
  emoji TEXT,                          -- single optional emoji for the icon

  archived BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0, -- drag-to-reorder

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classes_user_active
  ON classes(user_id, position)
  WHERE archived = FALSE;

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "classes_select_own" ON classes FOR SELECT USING (auth.uid() = user_id);

-- Touch updated_at on any UPDATE
CREATE OR REPLACE FUNCTION touch_classes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_classes ON classes;
CREATE TRIGGER trg_touch_classes
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION touch_classes_updated_at();

-- ── Wire mastery targets into classes (backwards-compatible) ────────────────
-- A class can own zero or more user_exams. A user_exam without a class is
-- still valid (existing behavior) — UI surfaces those under "Other targets".
ALTER TABLE user_exams
  ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_exams_class
  ON user_exams(class_id)
  WHERE class_id IS NOT NULL;

-- ── Class notes ─────────────────────────────────────────────────────────────
-- Typed/pasted/uploaded study material. Optional class_id so quick-note
-- capture from anywhere in the app can save first and AI-categorize after.
CREATE TABLE IF NOT EXISTS class_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,

  title TEXT,                          -- AI-generated or user-edited
  body TEXT NOT NULL,                  -- raw text; markdown welcome
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'quick', 'paste', 'upload')),

  -- AI-derived metadata (filled by /api/classes/quick-note)
  ai_categorized BOOLEAN NOT NULL DEFAULT FALSE,
  ai_topics TEXT[],                    -- e.g. ["chain rule", "implicit differentiation"]
  ai_summary TEXT,                     -- one-liner shown in lists

  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_notes_class
  ON class_notes(class_id, pinned DESC, updated_at DESC)
  WHERE archived = FALSE AND class_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_class_notes_user_unfiled
  ON class_notes(user_id, updated_at DESC)
  WHERE class_id IS NULL AND archived = FALSE;

ALTER TABLE class_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "class_notes_select_own" ON class_notes FOR SELECT USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_touch_class_notes ON class_notes;
CREATE TRIGGER trg_touch_class_notes
  BEFORE UPDATE ON class_notes
  FOR EACH ROW EXECUTE FUNCTION touch_classes_updated_at();

-- ── Daily plan cache ────────────────────────────────────────────────────────
-- AI-generated study plan per (class, day). Cached so reloading the
-- dashboard doesn't burn an OpenAI call every visit.
CREATE TABLE IF NOT EXISTS class_daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,

  -- Shape: { tasks: [{ kind, label, minutes, deepLink }], totalMinutes }
  plan JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ai_model TEXT,
  ai_cost_micro_usd INTEGER NOT NULL DEFAULT 0,

  UNIQUE(user_id, class_id, plan_date)
);

CREATE INDEX IF NOT EXISTS idx_class_daily_plans_lookup
  ON class_daily_plans(user_id, class_id, plan_date);

ALTER TABLE class_daily_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "class_daily_plans_select_own" ON class_daily_plans FOR SELECT USING (auth.uid() = user_id);
