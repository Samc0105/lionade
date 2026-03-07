-- Add avatar customization columns for style picker + ring color
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_color text;
