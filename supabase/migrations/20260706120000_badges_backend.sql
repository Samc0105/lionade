-- Migration: Badges backend (badges + user_badges) — create, seed, backfill
--
-- WHY: Both the web app (lib/db.ts getAllBadges/getUserBadges -> /badges +
-- /profile) and the iOS app (lib/hooks/use-badges.ts, which also opens a
-- realtime INSERT channel on user_badges) READ these tables, but they were
-- never created on prod — both surfaces have been erroring/empty since launch.
-- This migration creates the exact schema the readers expect (per the original
-- spec in lib/database.sql:105-143 + the RLS at database.sql:158,198-199),
-- seeds a 12-badge starter catalog aligned with awardBadges() in lib/badges.ts,
-- and retro-awards from existing data (quiz_sessions, profiles, friendships,
-- study_sets, techhub_shift_completions, vocab_words) so long-time users see
-- real earned badges immediately instead of an all-locked wall.
--
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO
-- NOTHING throughout; the realtime publication add is existence-guarded.

-- ── 1) Tables (exact shape from lib/database.sql:105-121) ────────────────────

CREATE TABLE IF NOT EXISTS public.badges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT NOT NULL,
  rarity      TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_badges (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_id  TEXT NOT NULL REFERENCES public.badges(id),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

-- ── 2) Indexes ────────────────────────────────────────────────────────────────
-- user_id: every reader filters on it (web getUserBadges, iOS hook, realtime
-- RLS filter). badge_id: FK hygiene (badges(id) referential checks + any
-- future per-badge earn counts).

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON public.user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON public.user_badges(badge_id);

-- ── 3) RLS ────────────────────────────────────────────────────────────────────
-- badges: public read (the locked-badge grid renders the full catalog for
-- everyone). user_badges: public read (badges show on public profiles),
-- SERVER-ONLY writes. The original lib/database.sql spec had an owner-insert
-- policy, but no client code path inserts user_badges (web lib/db.ts and the
-- iOS use-badges hook only read) and all awarding runs through lib/badges.ts
-- on the service role, which bypasses RLS. A client-insert policy would let
-- any signed-in user self-grant every badge (public social proof + a realtime
-- broadcast), so it is deliberately NOT created; the guarded DROP below also
-- removes it anywhere the legacy spec was ever applied.

ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badges_public_read" ON public.badges;
CREATE POLICY "badges_public_read" ON public.badges
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "user_badges_public_read" ON public.user_badges;
CREATE POLICY "user_badges_public_read" ON public.user_badges
  FOR SELECT USING (true);

-- Security: no INSERT/UPDATE/DELETE policies on user_badges — awards are
-- service-role only. Drop the legacy self-grant policy if it ever existed.
DROP POLICY IF EXISTS "user_badges_owner_insert" ON public.user_badges;

-- ── 4) Realtime ──────────────────────────────────────────────────────────────
-- The iOS use-badges hook subscribes to postgres_changes INSERT on
-- user_badges for instant cross-device earn notifications. Guarded so a
-- re-run doesn't error on "already member of publication".

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_badges'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_badges;
  END IF;
END $$;

-- ── 5) Seed — starter badge catalog ──────────────────────────────────────────
-- Ids/thresholds mirror lib/badges.ts badgesFor() EXACTLY (the award helper
-- and this seed must move together). The legacy b1-b8 seed in lib/database.sql
-- referenced retired features (duels) and said "coins" in user-facing copy
-- (currency is Fangs), so this is a fresh catalog: every badge here is
-- awardable from live features TODAY, either at write-time (lib/badges.ts
-- call sites) or via the backfill below.

INSERT INTO public.badges (id, name, description, icon, rarity) VALUES
  ('first_quiz',       'First Blood',    'Complete your first quiz',                       '🎯', 'common'),
  ('quizzes_10',       'Double Digits',  'Complete 10 quizzes',                            '📈', 'rare'),
  ('quizzes_50',       'Half Century',   'Complete 50 quizzes',                            '🏆', 'epic'),
  ('perfect_quiz',     'Flawless',       'Score a perfect 10 out of 10 on a quiz',         '💎', 'rare'),
  ('streak_3',         'Warming Up',     'Keep a 3-day study streak',                      '✨', 'common'),
  ('streak_7',         'On Fire',        'Keep a 7-day study streak',                      '🔥', 'rare'),
  ('streak_30',        'Unstoppable',    'Keep a 30-day study streak',                     '⚡', 'legendary'),
  ('fangs_1000',       'Fang Hoarder',   'Stack 1,000 Fangs in your wallet',               '💰', 'epic'),
  ('first_friend',     'Pride Member',   'Make your first friend',                         '🤝', 'common'),
  ('first_study_set',  'Set Builder',    'Publish your first study set to the Library',    '📚', 'rare'),
  ('first_shift',      'Desk Jockey',    'Clear your first TechHub shift',                 '🖥️', 'rare'),
  ('wordbank_starter', 'Word Collector', 'Save 10 words to your Word Banks',               '📖', 'common')
ON CONFLICT (id) DO NOTHING;

-- ── 6) Backfill — retro-award from existing data ─────────────────────────────
-- One-shot, idempotent (ON CONFLICT (user_id, badge_id) DO NOTHING everywhere).
-- Each source that isn't profiles joins/EXISTS against profiles so a stray
-- orphan row can never abort the whole migration on the user_badges FK.
-- Sources behind HELD migrations (study_sets, techhub_shift_completions) are
-- to_regclass-guarded so this file applies cleanly regardless of that state.

-- first_quiz: anyone with at least one completed quiz session.
INSERT INTO public.user_badges (user_id, badge_id)
SELECT DISTINCT qs.user_id, 'first_quiz'
FROM public.quiz_sessions qs
JOIN public.profiles p ON p.id = qs.user_id
ON CONFLICT (user_id, badge_id) DO NOTHING;

-- quizzes_10 / quizzes_50: lifetime session-count milestones.
INSERT INTO public.user_badges (user_id, badge_id)
SELECT qs.user_id, 'quizzes_10'
FROM public.quiz_sessions qs
JOIN public.profiles p ON p.id = qs.user_id
GROUP BY qs.user_id
HAVING COUNT(*) >= 10
ON CONFLICT (user_id, badge_id) DO NOTHING;

INSERT INTO public.user_badges (user_id, badge_id)
SELECT qs.user_id, 'quizzes_50'
FROM public.quiz_sessions qs
JOIN public.profiles p ON p.id = qs.user_id
GROUP BY qs.user_id
HAVING COUNT(*) >= 50
ON CONFLICT (user_id, badge_id) DO NOTHING;

-- perfect_quiz: a clean full-length run. The live award trigger is a 10/10
-- quiz; the backfill accepts >= 10 questions so longer historical perfect
-- runs also count (generous, never under-awards).
INSERT INTO public.user_badges (user_id, badge_id)
SELECT DISTINCT qs.user_id, 'perfect_quiz'
FROM public.quiz_sessions qs
JOIN public.profiles p ON p.id = qs.user_id
WHERE qs.total_questions >= 10
  AND qs.correct_answers >= qs.total_questions
ON CONFLICT (user_id, badge_id) DO NOTHING;

-- streak_3 / streak_7 / streak_30: best-ever streak. max_streak is the
-- historical peak; GREATEST() with the live streak covers any pre-max_streak
-- rows where only `streak` was maintained.
INSERT INTO public.user_badges (user_id, badge_id)
SELECT p.id, 'streak_3'
FROM public.profiles p
WHERE GREATEST(COALESCE(p.streak, 0), COALESCE(p.max_streak, 0)) >= 3
ON CONFLICT (user_id, badge_id) DO NOTHING;

INSERT INTO public.user_badges (user_id, badge_id)
SELECT p.id, 'streak_7'
FROM public.profiles p
WHERE GREATEST(COALESCE(p.streak, 0), COALESCE(p.max_streak, 0)) >= 7
ON CONFLICT (user_id, badge_id) DO NOTHING;

INSERT INTO public.user_badges (user_id, badge_id)
SELECT p.id, 'streak_30'
FROM public.profiles p
WHERE GREATEST(COALESCE(p.streak, 0), COALESCE(p.max_streak, 0)) >= 30
ON CONFLICT (user_id, badge_id) DO NOTHING;

-- fangs_1000: current wallet balance (matches the live trigger, which checks
-- the balance at quiz save).
INSERT INTO public.user_badges (user_id, badge_id)
SELECT p.id, 'fangs_1000'
FROM public.profiles p
WHERE COALESCE(p.coins, 0) >= 1000
ON CONFLICT (user_id, badge_id) DO NOTHING;

-- first_friend: both sides of every accepted friendship.
INSERT INTO public.user_badges (user_id, badge_id)
SELECT DISTINCT sides.uid, 'first_friend'
FROM (
  SELECT f.user_id AS uid FROM public.friendships f WHERE f.status = 'accepted'
  UNION
  SELECT f.friend_id FROM public.friendships f WHERE f.status = 'accepted'
) sides
JOIN public.profiles p ON p.id = sides.uid
ON CONFLICT (user_id, badge_id) DO NOTHING;

-- first_study_set: anyone who has ever published to the Library
-- (published_at is kept as history across unpublish, so it is the honest
-- "ever published" marker). Guarded: study_sets ships in a HELD migration.
DO $$
BEGIN
  IF to_regclass('public.study_sets') IS NOT NULL THEN
    INSERT INTO public.user_badges (user_id, badge_id)
    SELECT DISTINCT ss.user_id, 'first_study_set'
    FROM public.study_sets ss
    JOIN public.profiles p ON p.id = ss.user_id
    WHERE ss.is_public = TRUE OR ss.published_at IS NOT NULL
    ON CONFLICT (user_id, badge_id) DO NOTHING;
  END IF;
END $$;

-- first_shift: anyone with a banked TechHub shift completion. Guarded: the
-- techhub_shift_completions table ships in a HELD migration.
DO $$
BEGIN
  IF to_regclass('public.techhub_shift_completions') IS NOT NULL THEN
    INSERT INTO public.user_badges (user_id, badge_id)
    SELECT DISTINCT tsc.user_id, 'first_shift'
    FROM public.techhub_shift_completions tsc
    JOIN public.profiles p ON p.id = tsc.user_id
    ON CONFLICT (user_id, badge_id) DO NOTHING;
  END IF;
END $$;

-- wordbank_starter: 10+ saved Word Bank words. Guarded defensively even
-- though vocab_words is live on prod.
DO $$
BEGIN
  IF to_regclass('public.vocab_words') IS NOT NULL THEN
    INSERT INTO public.user_badges (user_id, badge_id)
    SELECT vw.user_id, 'wordbank_starter'
    FROM public.vocab_words vw
    JOIN public.profiles p ON p.id = vw.user_id
    GROUP BY vw.user_id
    HAVING COUNT(*) >= 10
    ON CONFLICT (user_id, badge_id) DO NOTHING;
  END IF;
END $$;
