-- Add preferences JSONB column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferences JSONB
  DEFAULT '{"theme":"dark","font_size":"medium","preferred_subjects":[]}'::jsonb;
