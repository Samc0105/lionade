-- Add timestamp-based activity tracking columns to profiles
-- Replaces date-based last_activity_date with exact timestamp for 36h expiry window
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_questions_completed INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_reset_date DATE;
