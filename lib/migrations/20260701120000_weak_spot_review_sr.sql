-- Weak-Spot Review — optional spaced-repetition columns on ninny_wrong_answers.
--
-- HELD: apply manually. The "Review your weak spots" feature works WITHOUT this
-- migration (it drives the schedule off miss_count + last_seen_at and the
-- API/UI fail soft when these columns are absent). Applying this migration
-- upgrades the schedule to a Leitner-box model with an explicit review streak
-- and next-interval, which spaces mastered-track items out more aggressively
-- and lets the client show a truer "next due" estimate.
--
-- Safe to apply on a live table: both columns are nullable with defaults, so
-- existing rows backfill to streak 0 / no explicit interval and behave exactly
-- as the fallback path already does.

ALTER TABLE ninny_wrong_answers
  ADD COLUMN IF NOT EXISTS review_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_interval_days INTEGER;

-- Order due-scanning by urgency (most-missed first) — matches the API's read.
-- (idx_ninny_wrong_answers_lookup already covers (user_id, material_id,
--  miss_count DESC); this adds a per-user last_seen ordering for the due scan.)
CREATE INDEX IF NOT EXISTS idx_ninny_wrong_answers_review
  ON ninny_wrong_answers (user_id, last_seen_at);

COMMENT ON COLUMN ninny_wrong_answers.review_streak IS
  'Consecutive correct spaced-repetition reviews. Promotes the Leitner box; row is deleted (mastered) at streak = 5.';
COMMENT ON COLUMN ninny_wrong_answers.review_interval_days IS
  'Explicit next-review interval in days, written on each grade. NULL = fall back to miss_count/streak-derived interval.';
