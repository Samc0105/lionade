-- Fix onboarding flag for all existing users who already have a username set.
-- These are users who completed onboarding before the flag existed, or whose
-- flag was never set to true.
--
-- Run this manually in Supabase SQL editor.

UPDATE profiles
SET onboarding_completed = true
WHERE username IS NOT NULL
  AND username <> ''
  AND (onboarding_completed IS NULL OR onboarding_completed = false);
