-- Migration 039: Performance indexes — additive query coverage sweep
--
-- This migration is the result of an audit of every Supabase query in the
-- codebase (543 .from() calls across 50+ tables) cross-referenced with the
-- existing index inventory in migrations 001-038. It adds composite and
-- partial indexes that cover hot filter/order combinations that today
-- either fall through to a sequential scan or require a bitmap-and across
-- two single-column indexes.
--
-- ABSOLUTE RULES:
--   * Additive only. No DROP, no ALTER, no schema changes.
--   * Every CREATE INDEX uses IF NOT EXISTS so this is safe to re-run.
--   * Naming convention follows the existing pattern: idx_{table}_{cols}.
--   * Composite ordering: most-selective filter first, ORDER BY column last.
--   * Partial indexes (WHERE …) used wherever the workload is dominated by
--     a single discriminator value (status='waiting', archived=false, etc).
--
-- Each section below explains the read pattern that motivated the index
-- and the file/line where that pattern lives. Treat this as the authoritative
-- map from query to index for the database from this point forward.

-- ════════════════════════════════════════════════════════════════════════
-- coin_transactions  —  the single hottest table after profiles
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (user_id), (created_at DESC)
--
-- Query patterns the existing indexes do NOT cover well:
--   * WHERE user_id=X AND type=Y AND created_at >= Z
--       — focus-session daily cap (app/api/focus-session/route.ts)
--       — login-bonus eligibility (app/api/login-bonus/route.ts)
--       — mission progress (lib/missions.ts)
--       — study-dna focus count (app/api/study-dna/route.ts)
--   * WHERE user_id IN (...) AND created_at >= weekStart AND amount > 0
--       — social feed weekly leaderboard (app/api/social/feed/route.ts)

-- (user_id, type, created_at DESC) — the full hot composite. Most queries
-- pin user + type then bound created_at. With user_id leading, this also
-- subsumes the single-column user_id lookups.
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_type_created
  ON coin_transactions(user_id, type, created_at DESC);

-- Partial index for the social-feed weekly aggregation. Most rows have
-- amount > 0; the few negative rows (purchases, stakes) are filtered out
-- by the feed. Keeps the index hot and small.
CREATE INDEX IF NOT EXISTS idx_coin_transactions_feed
  ON coin_transactions(user_id, created_at DESC)
  WHERE amount > 0;

-- ════════════════════════════════════════════════════════════════════════
-- quiz_sessions  —  legacy quiz history + missions
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (user_id), (completed_at DESC)
--
-- Hot path: WHERE user_id = X ORDER BY completed_at DESC LIMIT N
-- (lib/db.ts getQuizHistory, getRecentActivity-equivalent, daily charts,
--  weekly charts, missions same-day quiz counts).
-- The existing two single-column indexes force a bitmap-and; one composite
-- is strictly better.
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_completed
  ON quiz_sessions(user_id, completed_at DESC);

-- (user_id, subject) for the .match({ subject: X }) bounty progress paths
-- and lib/missions.ts subject-tagged bounties.
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_subject
  ON quiz_sessions(user_id, subject);

-- ════════════════════════════════════════════════════════════════════════
-- profiles  —  leaderboards + lookups
-- ════════════════════════════════════════════════════════════════════════
-- Existing: PK(id), UNIQUE(username), (coins DESC), (plan) WHERE plan<>'free',
-- (id) WHERE academia_onboarded_at IS NOT NULL.
--
-- Missing: dedicated ELO leaderboard sort (lib/db.ts getEloLeaderboard).
-- 200-row scan ordered by arena_elo DESC needs a btree to avoid a sort.
CREATE INDEX IF NOT EXISTS idx_profiles_arena_elo
  ON profiles(arena_elo DESC);

-- ════════════════════════════════════════════════════════════════════════
-- user_exams  —  mastery exam list + class joins
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (user_id, archived, updated_at DESC), (topic_hash),
-- (class_id) WHERE class_id IS NOT NULL.
--
-- The class-detail page filters by (user_id, class_id, archived) and orders
-- by target_date — see app/api/classes/[id]/route.ts and …/plan/route.ts.
-- Existing (class_id) partial gets you to the class but then has to scan
-- all rows with that class to filter by user_id+archived. Composite wins.
CREATE INDEX IF NOT EXISTS idx_user_exams_user_class_active
  ON user_exams(user_id, class_id, archived)
  WHERE archived = FALSE;

-- ════════════════════════════════════════════════════════════════════════
-- mastery_events  —  daily drill seed + analytics
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (session_id, created_at), (user_id, question_id) WHERE question_id IS NOT NULL,
-- (created_at) WHERE ai_cost_micro_usd IS NOT NULL.
--
-- The Daily Drill picks wrong-answer questions for a user:
--   WHERE user_id=X AND event_type='answer' AND was_correct=false ORDER BY created_at DESC
-- (app/api/daily-drill/route.ts). Today this scans every event for the user
-- and filters in memory. A partial index on the wrong-answer slice is a
-- huge win because for a healthy user, was_correct=false is the minority
-- of events.
CREATE INDEX IF NOT EXISTS idx_mastery_events_user_wrong
  ON mastery_events(user_id, created_at DESC)
  WHERE event_type = 'answer' AND was_correct = false;

-- Heatmap query: (user_id, created_at >= 30d ago) for any event_type in
-- ('answer','teach_served') — see app/api/study-dna/route.ts. Existing
-- (session_id, created_at) doesn't help; the user_id col was indexed only
-- via the partial above. Add a general (user_id, created_at) so the
-- heatmap range scan is plain.
CREATE INDEX IF NOT EXISTS idx_mastery_events_user_created
  ON mastery_events(user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════
-- class_notes  —  per-class + per-user listings
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (class_id, pinned DESC, updated_at DESC) WHERE class_id IS NOT NULL AND archived=false,
-- (user_id, updated_at DESC) WHERE class_id IS NULL AND archived=false.
--
-- The class-detail and per-class notes routes filter by (class_id, user_id,
-- archived). The existing class_id partial index doesn't include user_id,
-- so a malicious or buggy caller asking for someone else's note in this
-- class would scan all notes in the class. Add (class_id, user_id) for
-- both perf and defense in depth (RLS still enforces ownership).
CREATE INDEX IF NOT EXISTS idx_class_notes_class_user
  ON class_notes(class_id, user_id, updated_at DESC)
  WHERE archived = FALSE;

-- ════════════════════════════════════════════════════════════════════════
-- arena_matches  —  match lookups by player + winner
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (player1_id, player2_id), (status) WHERE status IN ('pending','active').
--
-- Mission progress queries (lib/missions.ts) hit:
--   WHERE winner_id=X AND status='completed' AND created_at >= today
--   WHERE status='completed' AND created_at >= today  (count daily wins)
-- The (player1_id, player2_id) composite is useless when only one of the
-- two is bound (which is every realistic query against this table).
CREATE INDEX IF NOT EXISTS idx_arena_matches_player1
  ON arena_matches(player1_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_matches_player2
  ON arena_matches(player2_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arena_matches_winner
  ON arena_matches(winner_id, created_at DESC)
  WHERE status = 'completed';

-- ════════════════════════════════════════════════════════════════════════
-- arena_challenges  —  outgoing challenges by status
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (challenged_id, status) WHERE status='pending', (challenger_id).
--
-- The challenge route also queries:
--   WHERE challenger_id=X AND status='pending'  (rate-limit check)
--   WHERE challenger_id=X AND status='accepted' ORDER BY created_at DESC
-- (app/api/arena/challenge/route.ts). Bare (challenger_id) forces a scan
-- of all that user's historical challenges to filter by status.
CREATE INDEX IF NOT EXISTS idx_arena_challenges_challenger_status
  ON arena_challenges(challenger_id, status, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════
-- arena_answers  —  per-user answer lookups
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (match_id), (match_id, user_id), UNIQUE(match_id, question_id, user_id).
--
-- The UNIQUE already covers the (match_id, question_id, user_id) "did this
-- player answer this question" lookup in app/api/arena/answer/route.ts.
-- Nothing to add here.

-- ════════════════════════════════════════════════════════════════════════
-- messages  —  DM thread lookup + unread tally
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (sender_id, created_at), (receiver_id, created_at),
-- (receiver_id, read) WHERE read=false.
--
-- Marking-as-read query:
--   UPDATE messages SET read=true WHERE sender_id=A AND receiver_id=B AND read=false
-- (app/api/social/messages/route.ts). The receiver-only partial doesn't
-- include sender_id so it has to read every unread message TO me and
-- filter by sender. Composite (sender_id, receiver_id, read) is small and
-- closes the loop.
CREATE INDEX IF NOT EXISTS idx_messages_pair_unread
  ON messages(sender_id, receiver_id)
  WHERE read = FALSE;

-- ════════════════════════════════════════════════════════════════════════
-- active_boosters  —  shop activate-booster + quiz consumption
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (user_id).
--
-- The activate-booster and consume-on-quiz paths both filter by
--   WHERE user_id=X AND boost_type=Y AND uses_remaining > 0
-- (app/api/shop/activate-booster/route.ts, save-quiz-results/route.ts).
-- Composite avoids loading every booster the user has ever owned.
CREATE INDEX IF NOT EXISTS idx_active_boosters_user_boost_type
  ON active_boosters(user_id, boost_type)
  WHERE uses_remaining > 0;

-- ════════════════════════════════════════════════════════════════════════
-- user_inventory  —  no extra index needed
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (user_id), UNIQUE(user_id, item_id).
--
-- The schema has no `item_type` column on this table — the planned
-- (user_id, item_type) composite was based on a wrong assumption from
-- the audit pass. Equip flows go through (user_id, item_id) which the
-- UNIQUE already covers. No index added here.

-- ════════════════════════════════════════════════════════════════════════
-- bounties  —  active rotation
-- ════════════════════════════════════════════════════════════════════════
-- Existing: PK(id) only.
--
-- save-quiz-results awards bounties via:
--   SELECT * FROM bounties WHERE active = true
-- A partial index on active=true is tiny (only 5-8 rows ever match) and
-- means the query never touches the historical pool of inactive bounties.
CREATE INDEX IF NOT EXISTS idx_bounties_active
  ON bounties(id)
  WHERE active = TRUE;

-- ════════════════════════════════════════════════════════════════════════
-- questions  —  quiz question selection
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (subject).
--
-- getQuestionsForQuiz filters by:
--   WHERE subject=X AND difficulty=Y [AND topic=Z]
-- (lib/db.ts). The subject-only index forces a per-subject scan + filter
-- on difficulty. Composite covers both.
--
-- NOTE: not adding (topic) standalone because the column was added outside
-- the migration system and we can't be sure of its current state on prod
-- without a check. The .from('questions').eq('topic', …) pattern is rare
-- enough that the existing subject filter remaining in the plan is fine.
CREATE INDEX IF NOT EXISTS idx_questions_subject_difficulty
  ON questions(subject, difficulty);

-- ════════════════════════════════════════════════════════════════════════
-- daily_bets  —  per-user resolved/unresolved bet history
-- ════════════════════════════════════════════════════════════════════════
-- Existing: (user_id).
--
-- lib/db.ts queries bets by:
--   WHERE user_id=X ORDER BY placed_at DESC
--   WHERE user_id=X ORDER BY resolved_at DESC
-- A user with a long bet history hits a sort. Two cheap composites cover
-- both orders.
CREATE INDEX IF NOT EXISTS idx_daily_bets_user_placed
  ON daily_bets(user_id, placed_at DESC);

-- (resolved_at can be NULL for open bets — partial keeps it small)
CREATE INDEX IF NOT EXISTS idx_daily_bets_user_resolved
  ON daily_bets(user_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;
