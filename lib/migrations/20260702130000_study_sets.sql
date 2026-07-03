-- Ninny Study Sets: paste anything -> instant deck.
--
-- HELD: apply manually (Sam).
--
-- WHAT THIS DOES:
--   1. study_sets  — one row per user-created deck. The is_public /
--      published_at / clone_count / cloned_from columns are DEFINED here for
--      the Library feature being built in parallel (this migration owns the
--      schema; the Library owns the publishing routes).
--   2. study_cards — the cards inside a deck. Two shapes:
--        flashcard: front/back reveal + self-grade
--        mcq:       front + 4 jsonb options + correct_index, back = explanation
--      SM-2 state mirrors vocab_words semantics (ease 1.30..5.00 default 2.5,
--      interval_days, next_due_at, review_count/correct_count) so the Review
--      Hub can schedule them alongside every other source.
--
-- FAIL-SOFT CONTRACT (until applied):
--   - /api/study-sets/generate still works (preview only, nothing saved).
--   - Saving/listing decks returns an honest notReady response; pages degrade,
--     never 500.
--   - The Review Hub's study_set source contributes zero items silently.
--
-- Safe to re-run: CREATE IF NOT EXISTS + guarded policies throughout.

-- ── 1) study_sets ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS study_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 200),
  subject TEXT CHECK (subject IS NULL OR char_length(subject) <= 60),
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  card_count INTEGER NOT NULL DEFAULT 0,
  -- Library feature columns (defined here, used by the parallel Library build)
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  clone_count INTEGER NOT NULL DEFAULT 0,
  cloned_from UUID REFERENCES study_sets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_sets_user_updated
  ON study_sets (user_id, updated_at DESC);
-- Library browse index: only public decks, newest published first.
CREATE INDEX IF NOT EXISTS idx_study_sets_public_published
  ON study_sets (published_at DESC) WHERE is_public;

ALTER TABLE study_sets ENABLE ROW LEVEL SECURITY;

-- Owner-only, except public decks are world-readable (Library browse).
DROP POLICY IF EXISTS "study_sets_select_own_or_public" ON study_sets;
CREATE POLICY "study_sets_select_own_or_public"
  ON study_sets FOR SELECT USING (auth.uid() = user_id OR is_public = TRUE);

-- NO INSERT / UPDATE / DELETE policies ON PURPOSE (streak_pacts pattern):
-- every write goes through the /api/study-sets/* and /api/library/* routes on
-- supabaseAdmin (service role bypasses RLS). A direct-PostgREST write policy
-- would let an owner bypass server moderation and invariants: flip is_public
-- without the publish route's moderation scan, self-inflate clone_count, or
-- forge card_count. The DROPs below also clean up any previously-applied copy
-- of this file that carried the old write policies.
DROP POLICY IF EXISTS "study_sets_insert_own" ON study_sets;
DROP POLICY IF EXISTS "study_sets_update_own" ON study_sets;
DROP POLICY IF EXISTS "study_sets_delete_own" ON study_sets;

COMMENT ON TABLE study_sets IS
  'Ninny Study Sets: user decks generated from pasted material (with mandatory preview/trim before save). is_public/published_at/clone_count/cloned_from are reserved for the Library feature.';

-- ── 2) study_cards ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS study_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('flashcard', 'mcq')),
  front TEXT NOT NULL CHECK (char_length(front) BETWEEN 1 AND 500),
  back TEXT NOT NULL CHECK (char_length(back) BETWEEN 1 AND 500),
  options JSONB,
  correct_index INTEGER CHECK (correct_index IS NULL OR (correct_index >= 0 AND correct_index <= 3)),
  -- MCQ shape guard: an mcq card must carry options + a valid correct_index.
  CONSTRAINT study_cards_mcq_shape CHECK (
    type <> 'mcq' OR (options IS NOT NULL AND correct_index IS NOT NULL)
  ),
  -- SM-2 state (mirrors vocab_words semantics; see lib/vocab.ts sm2Advance)
  -- Bounds are cast to ::real explicitly: `ease` is float32, and a bare 1.30
  -- literal in a CHECK is float8. Float32 can't represent 1.3 exactly (it
  -- stores 1.29999995...), so `ease >= 1.30::float8` FAILS at the code's own
  -- clamp minimum. Comparing real-to-real keeps the boundary values legal.
  ease REAL NOT NULL DEFAULT 2.5 CHECK (ease >= 1.3::real AND ease <= 5.0::real),
  interval_days REAL,
  next_due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_cards_set
  ON study_cards (set_id);
-- Review Hub due-queue lookup: user's due cards ordered by next_due_at.
CREATE INDEX IF NOT EXISTS idx_study_cards_user_due
  ON study_cards (user_id, next_due_at);

ALTER TABLE study_cards ENABLE ROW LEVEL SECURITY;

-- Owner-only, except cards of a public deck are world-readable (Library).
DROP POLICY IF EXISTS "study_cards_select_own_or_public" ON study_cards;
CREATE POLICY "study_cards_select_own_or_public"
  ON study_cards FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM study_sets s
      WHERE s.id = study_cards.set_id AND s.is_public = TRUE
    )
  );

-- NO INSERT / UPDATE / DELETE policies ON PURPOSE (streak_pacts pattern):
-- writes go through /api/study-sets/* on supabaseAdmin only. The old insert
-- policy checked ONLY user_id, so any authenticated user could inject cards
-- into ANY set (including someone else's published deck) via direct PostgREST.
-- Update/delete policies would also let owners mutate published content behind
-- the server's moderation + card_count accounting. The DROPs clean up any
-- previously-applied copy of this file that carried the old write policies.
DROP POLICY IF EXISTS "study_cards_insert_own" ON study_cards;
DROP POLICY IF EXISTS "study_cards_update_own" ON study_cards;
DROP POLICY IF EXISTS "study_cards_delete_own" ON study_cards;

COMMENT ON TABLE study_cards IS
  'Cards inside a study set. type=flashcard (front/back) or mcq (4 jsonb options + correct_index, back = explanation). SM-2 columns mirror vocab_words; graded reward-free via /api/study-sets/cards/[cardId]/review.';
