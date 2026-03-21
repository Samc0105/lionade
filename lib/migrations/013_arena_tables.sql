-- ============================================================
-- 013: Arena Tables — 1v1 Duel Arena (real-time competitive)
-- ============================================================

-- Add ELO rating column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS arena_elo integer NOT NULL DEFAULT 1000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS arena_wins integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS arena_losses integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS arena_draws integer NOT NULL DEFAULT 0;

-- ── Arena Queue (matchmaking) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  elo_rating integer NOT NULL DEFAULT 1000,
  wager integer NOT NULL DEFAULT 10,
  joined_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'cancelled')),
  match_id uuid,
  UNIQUE (user_id, status)
);

CREATE INDEX IF NOT EXISTS idx_arena_queue_status ON arena_queue(status) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_arena_queue_user ON arena_queue(user_id);

-- ── Arena Matches ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  player2_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_ids uuid[] NOT NULL DEFAULT '{}',
  wager integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  current_question integer NOT NULL DEFAULT 0,
  player1_score integer NOT NULL DEFAULT 0,
  player2_score integer NOT NULL DEFAULT 0,
  player1_total_points integer NOT NULL DEFAULT 0,
  player2_total_points integer NOT NULL DEFAULT 0,
  winner_id uuid REFERENCES profiles(id),
  player1_elo_before integer,
  player2_elo_before integer,
  player1_elo_after integer,
  player2_elo_after integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_players ON arena_matches(player1_id, player2_id);
CREATE INDEX IF NOT EXISTS idx_arena_matches_status ON arena_matches(status) WHERE status IN ('pending', 'active');

-- ── Arena Match Questions (judge results per question) ────────
CREATE TABLE IF NOT EXISTS arena_match_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  question_order integer NOT NULL,
  time_limit integer NOT NULL DEFAULT 15,
  cognitive_load text NOT NULL DEFAULT 'recall' CHECK (cognitive_load IN ('recall', 'calculation', 'reasoning')),
  UNIQUE (match_id, question_order)
);

CREATE INDEX IF NOT EXISTS idx_arena_match_questions_match ON arena_match_questions(match_id);

-- ── Arena Answers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arena_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  selected_answer integer,
  is_correct boolean NOT NULL DEFAULT false,
  response_time_ms integer,
  points_earned integer NOT NULL DEFAULT 0,
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_answers_match ON arena_answers(match_id);
CREATE INDEX IF NOT EXISTS idx_arena_answers_user ON arena_answers(match_id, user_id);

-- ── Arena Challenges (friend invites) ─────────────────────────
CREATE TABLE IF NOT EXISTS arena_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  challenged_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  wager integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  match_id uuid REFERENCES arena_matches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

CREATE INDEX IF NOT EXISTS idx_arena_challenges_challenged ON arena_challenges(challenged_id, status)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_arena_challenges_challenger ON arena_challenges(challenger_id);

-- ── RLS Policies ──────────────────────────────────────────────
ALTER TABLE arena_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_match_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_challenges ENABLE ROW LEVEL SECURITY;

-- Queue: users can see/manage their own entries, read others for matchmaking
CREATE POLICY arena_queue_select ON arena_queue FOR SELECT USING (true);
CREATE POLICY arena_queue_insert ON arena_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY arena_queue_update ON arena_queue FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY arena_queue_delete ON arena_queue FOR DELETE USING (auth.uid() = user_id);

-- Matches: players can see their own matches
CREATE POLICY arena_matches_select ON arena_matches FOR SELECT
  USING (auth.uid() = player1_id OR auth.uid() = player2_id);
CREATE POLICY arena_matches_insert ON arena_matches FOR INSERT WITH CHECK (true);
CREATE POLICY arena_matches_update ON arena_matches FOR UPDATE USING (true);

-- Match questions: visible to match participants
CREATE POLICY arena_match_questions_select ON arena_match_questions FOR SELECT USING (true);
CREATE POLICY arena_match_questions_insert ON arena_match_questions FOR INSERT WITH CHECK (true);

-- Answers: users can see answers in their matches, insert their own
CREATE POLICY arena_answers_select ON arena_answers FOR SELECT USING (true);
CREATE POLICY arena_answers_insert ON arena_answers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY arena_answers_update ON arena_answers FOR UPDATE USING (true);

-- Challenges: users can see challenges involving them
CREATE POLICY arena_challenges_select ON arena_challenges FOR SELECT
  USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);
CREATE POLICY arena_challenges_insert ON arena_challenges FOR INSERT
  WITH CHECK (auth.uid() = challenger_id);
CREATE POLICY arena_challenges_update ON arena_challenges FOR UPDATE
  USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

-- ── Enable Realtime for arena tables ──────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE arena_answers;
ALTER PUBLICATION supabase_realtime ADD TABLE arena_matches;
ALTER PUBLICATION supabase_realtime ADD TABLE arena_challenges;

-- ── Cleanup function: auto-expire stale queue entries ─────────
CREATE OR REPLACE FUNCTION cleanup_arena_queue() RETURNS void AS $$
BEGIN
  UPDATE arena_queue SET status = 'cancelled'
  WHERE status = 'waiting' AND joined_at < now() - interval '5 minutes';

  UPDATE arena_challenges SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
