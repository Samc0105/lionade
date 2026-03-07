-- Add missing profile fields for Edit Profile page
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio text CHECK (char_length(bio) <= 150),
  ADD COLUMN IF NOT EXISTS education_level text,
  ADD COLUMN IF NOT EXISTS study_goal text;
