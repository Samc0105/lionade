-- Add last_activity_date to profiles for proper daily streak tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_activity_date DATE;
