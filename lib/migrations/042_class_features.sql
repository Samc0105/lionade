-- Migration 042: Class features — grades, per-class streaks, flashcards, syllabus.
--
-- Builds out the Academia hub's "Top 5" features:
--   * class_grades       — student-entered graded items + weights for grade tracking
--   * class_streaks      — last study activity per (user, class) for per-class streaks
--   * class_flashcards   — AI-generated cards from notes + manual cards
--   * class_syllabi      — uploaded syllabi (file ref + AI-extracted plan)
-- All FK to profiles(id) (NOT public.users) — see migration 040 for context.

-- ─── 1) class_grades ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS class_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  category TEXT,                              -- e.g. "exam", "quiz", "homework", "project"
  earned_points NUMERIC(8,2),                 -- nullable until graded
  max_points NUMERIC(8,2) NOT NULL,
  weight_pct NUMERIC(5,2) NOT NULL DEFAULT 0, -- 0..100; weights across one class don't have to sum to 100 (we normalize)

  -- Future-final calculator wants to know which row IS the final.
  is_final BOOLEAN NOT NULL DEFAULT FALSE,

  due_date DATE,
  graded_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_grades_user_class
  ON class_grades(user_id, class_id);

ALTER TABLE class_grades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "class_grades_select_own" ON class_grades;
CREATE POLICY "class_grades_select_own"
  ON class_grades FOR SELECT USING (auth.uid() = user_id);

-- ─── 2) class_streaks ──────────────────────────────────────────────
-- Single row per (user, class). On any class-scoped activity (note add,
-- flashcard study, plan tap), bump last_activity_at and re-derive streak.
CREATE TABLE IF NOT EXISTS class_streaks (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,

  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ,

  PRIMARY KEY (user_id, class_id)
);

ALTER TABLE class_streaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "class_streaks_select_own" ON class_streaks;
CREATE POLICY "class_streaks_select_own"
  ON class_streaks FOR SELECT USING (auth.uid() = user_id);

-- ─── 3) class_flashcards ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS class_flashcards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,

  -- The note this card was generated from (NULL for manual cards).
  source_note_id UUID REFERENCES class_notes(id) ON DELETE SET NULL,

  question TEXT NOT NULL,
  answer   TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai_note'      -- 'ai_note' | 'manual'
    CHECK (source IN ('ai_note', 'manual')),

  -- Lightweight spaced-rep state (optional; used by the study UI later).
  ease NUMERIC(4,2) NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 1,
  next_due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviews INTEGER NOT NULL DEFAULT 0,

  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_flashcards_class_user_due
  ON class_flashcards(class_id, user_id, next_due_at)
  WHERE archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_class_flashcards_source_note
  ON class_flashcards(source_note_id)
  WHERE source_note_id IS NOT NULL;

ALTER TABLE class_flashcards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "class_flashcards_select_own" ON class_flashcards;
CREATE POLICY "class_flashcards_select_own"
  ON class_flashcards FOR SELECT USING (auth.uid() = user_id);

-- ─── 4) class_syllabi ──────────────────────────────────────────────
-- Stores the original file reference + the AI-extracted summary. The
-- per-day plan rows still live in class_daily_plans (existing table).
CREATE TABLE IF NOT EXISTS class_syllabi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,

  -- Storage path in Supabase Storage (bucket: 'class-syllabi'). The bucket
  -- must be created via Supabase dashboard / API; we just record the path.
  storage_path TEXT,
  filename TEXT,
  file_size_bytes INTEGER,

  raw_text TEXT,                              -- extracted PDF text (truncated)
  parsed_topics JSONB,                        -- [{ topic, week_n, est_hours }]
  parsed_exams JSONB,                         -- [{ name, date, weight_pct }]

  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'parsing', 'parsed', 'failed')),
  parse_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_syllabi_class_user
  ON class_syllabi(class_id, user_id, created_at DESC);

ALTER TABLE class_syllabi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "class_syllabi_select_own" ON class_syllabi;
CREATE POLICY "class_syllabi_select_own"
  ON class_syllabi FOR SELECT USING (auth.uid() = user_id);
