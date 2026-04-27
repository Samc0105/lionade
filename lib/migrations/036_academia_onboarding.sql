-- Migration 036: Academia onboarding fields.
--
-- Captures per-user school context the Academia hub uses to tune the
-- experience (study plan length, exam-load expectations, copy tone,
-- whether to surface "your professor" prompts, etc).
--
-- onboarded_at is the source of truth for "have they finished the
-- Academia gate?" — NULL means the gate redirects them to /academia/
-- onboarding. We don't reuse the global `onboarding_completed` flag
-- because users who signed up before this feature already have it set
-- to true, and we want to retroactively gate them on Academia entry.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'academia_school_type') THEN
    ALTER TABLE profiles ADD COLUMN academia_school_type TEXT
      CHECK (academia_school_type IN (
        'middle', 'high', 'college', 'grad', 'professional', 'self_study', 'other'
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'academia_grade_year') THEN
    ALTER TABLE profiles ADD COLUMN academia_grade_year TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'academia_class_count') THEN
    ALTER TABLE profiles ADD COLUMN academia_class_count INTEGER
      CHECK (academia_class_count >= 0 AND academia_class_count <= 30);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'academia_school_name') THEN
    ALTER TABLE profiles ADD COLUMN academia_school_name TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'academia_field') THEN
    ALTER TABLE profiles ADD COLUMN academia_field TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'academia_study_intensity') THEN
    ALTER TABLE profiles ADD COLUMN academia_study_intensity TEXT
      CHECK (academia_study_intensity IN ('chill', 'steady', 'grinding', 'cramming'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'profiles' AND column_name = 'academia_onboarded_at') THEN
    ALTER TABLE profiles ADD COLUMN academia_onboarded_at TIMESTAMPTZ;
  END IF;
END $$;

-- Quick lookup for "is this user gated?"
CREATE INDEX IF NOT EXISTS idx_profiles_academia_onboarded
  ON profiles(id) WHERE academia_onboarded_at IS NOT NULL;
