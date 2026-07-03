-- Review Hub + true SM-2 for weak spots.
--
-- HELD: apply manually (Sam).
--
-- LAYERS ON the already-HELD 20260701120000_weak_spot_review_sr.sql (Leitner
-- columns review_streak / review_interval_days). Section 1 below re-asserts
-- those columns idempotently, so this file is safe to apply whether or not
-- 20260701120000 has been applied first. Apply order: 20260701120000 then
-- this file, OR just this file (it is a superset).
--
-- WHAT THIS DOES:
--   1. Re-asserts the Leitner SR columns from 20260701120000 (IF NOT EXISTS).
--   2. Adds true SM-2 state to ninny_wrong_answers:
--        ease_factor  real NOT NULL DEFAULT 2.5, CHECK 1.30..5.00
--                     (mirrors vocab_words.ease_factor semantics)
--        next_due_at  timestamptz NULL — backfilled LAZILY by code on the
--                     next grade of each row; NULL rows fall back to the
--                     derived miss_count/streak/ease schedule.
--   3. Creates review_events — a lightweight per-grade outcome log across ALL
--      spaced-repetition sources (weak spots, vocab, class flashcards, and a
--      reserved 'study_set' source), powering the Review Hub's 7-day
--      retention stat. Writes are service-role only (no INSERT policy).
--
-- FAIL-SOFT CONTRACT (until applied):
--   - lib/weak-spot-review.ts + the grade route detect the missing columns and
--     stay on the Leitner (or base miss_count) schedule. Nothing 500s.
--   - review_events inserts are swallowed (undefined-table) and the Hub's
--     retention stat is hidden.
--
-- Safe on a live table: new columns have defaults / are nullable, the CHECK is
-- guarded so re-running is a no-op, and review_events is CREATE IF NOT EXISTS.

-- ── 1) Re-assert 20260701120000 (idempotent) ────────────────────────────────

ALTER TABLE ninny_wrong_answers
  ADD COLUMN IF NOT EXISTS review_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_interval_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_ninny_wrong_answers_review
  ON ninny_wrong_answers (user_id, last_seen_at);

-- ── 2) SM-2 columns ─────────────────────────────────────────────────────────

ALTER TABLE ninny_wrong_answers
  ADD COLUMN IF NOT EXISTS ease_factor REAL NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS next_due_at TIMESTAMPTZ;

-- CHECK added separately + guarded so the whole file is safely re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ninny_wrong_answers_ease_factor_range'
      AND conrelid = 'ninny_wrong_answers'::regclass
  ) THEN
    -- Bounds are cast to ::real explicitly: ease_factor is float32, and a bare
    -- 1.30 literal in a CHECK is float8. Float32 can't represent 1.3 exactly
    -- (it stores 1.29999995...), so `ease_factor >= 1.30::float8` FAILS at the
    -- code's own clamp minimum. Real-to-real keeps the boundary values legal.
    ALTER TABLE ninny_wrong_answers
      ADD CONSTRAINT ninny_wrong_answers_ease_factor_range
      CHECK (ease_factor >= 1.3::real AND ease_factor <= 5.0::real);
  END IF;
END $$;

COMMENT ON COLUMN ninny_wrong_answers.ease_factor IS
  'SM-2 ease factor (1.30..5.00, default 2.5). +0.1 on a correct review, -0.2 on a wrong one; scales the Leitner base interval.';
COMMENT ON COLUMN ninny_wrong_answers.next_due_at IS
  'Explicit SM-2 next-due timestamp, written on each grade. NULL = not yet graded under SM-2; code falls back to the derived miss_count/streak/ease schedule.';

-- ── 3) review_events — cross-source review outcome log ─────────────────────

CREATE TABLE IF NOT EXISTS review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL
    CHECK (source IN ('weak_spot', 'vocab', 'class_flashcard', 'study_set')),
  correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_events_user_created
  ON review_events (user_id, created_at);

ALTER TABLE review_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_events_select_own" ON review_events;
CREATE POLICY "review_events_select_own"
  ON review_events FOR SELECT USING (auth.uid() = user_id);

-- Writes are service-role only (server routes via supabaseAdmin). No INSERT /
-- UPDATE / DELETE policies on purpose: a user JWT cannot fabricate retention.

COMMENT ON TABLE review_events IS
  'One row per spaced-repetition grade across all SR sources. Powers the Review Hub 7-day retention stat. Service-role writes only.';
