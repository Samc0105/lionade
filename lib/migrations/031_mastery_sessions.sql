-- Migration 031: Mastery Mode — sessions, chat messages, event log
--
-- A session is one sitting with Ninny on a user_exam. Sessions have a chat
-- thread (`mastery_messages`) visible to the user, an event log
-- (`mastery_events`) used for analytics + cost telemetry, and a small
-- orchestrator state (`runtime_state` JSONB) that the server updates as it
-- picks the next card. Client is never trusted to decide what's next.
--
-- Time tracking: the client sends 10-second heartbeats while the page is
-- visible AND the user was active within the last 60s. The answer/heartbeat
-- routes bump `active_seconds` with a 15-second sanity cap per heartbeat.

CREATE TABLE IF NOT EXISTS mastery_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_exam_id UUID NOT NULL REFERENCES user_exams(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'abandoned')),

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,

  active_seconds INTEGER NOT NULL DEFAULT 0,

  -- Running totals (also derivable from events, but cached for fast display)
  questions_answered INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  teaching_panels_shown INTEGER NOT NULL DEFAULT 0,
  explanations_shown INTEGER NOT NULL DEFAULT 0,   -- AI Haiku explanation spends
  socratic_turns_spent INTEGER NOT NULL DEFAULT 0, -- Haiku socratic probe spends

  -- Snapshot pPass at start vs. now, for the session summary card
  starting_p_pass REAL,
  current_p_pass REAL,

  -- Server-side orchestrator state. Shape roughly:
  --   { pending: { type: "teach" | "question" | "socratic", ... } | null,
  --     last_subtopic_id: uuid | null,
  --     panels_shown_for: { [subtopicId]: count },
  --     reached_mastery_celebrated: boolean }
  runtime_state JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Session stays open past 100% mastery. This timestamp is set the first
  -- time the user crosses `ready_threshold` during this session so we can
  -- gate Fangs + streak contributions in the answer route.
  reached_mastery_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mastery_sessions_user_active
  ON mastery_sessions(user_id, status, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_mastery_sessions_exam
  ON mastery_sessions(user_exam_id, last_active_at DESC);

-- The visible chat thread. User messages, Ninny messages (teach / question /
-- socratic probe / feedback / celebration), all in one table so the UI just
-- reads the thread in order.
CREATE TABLE IF NOT EXISTS mastery_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES mastery_sessions(id) ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('ninny', 'user', 'system')),
  kind TEXT NOT NULL
    CHECK (kind IN ('text', 'teach', 'question', 'answer', 'feedback',
                    'socratic_probe', 'socratic_reply', 'celebrate', 'narrow')),

  -- Freeform content for text / feedback / narrow / celebrate.
  content TEXT,

  -- Structured payload for kind='teach' / kind='question' / kind='answer' /
  -- kind='feedback' / etc. Lets us render richly without new tables per kind.
  -- Examples:
  --   teach:    { title, tldr, bullets, mnemonic, common_pitfall, subtopicId }
  --   question: { questionId, text, options[4], difficulty, subtopicId,
  --               challengeToken }
  --   answer:   { questionId, selectedIndex, timeMs }
  --   feedback: { wasCorrect, correctIndex, explanation, aiMistakeExplanation? }
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Snapshot of bar values after this message so the UI can replay history
  -- with the bar at the right spot if the user scrolls up.
  p_pass_after REAL,
  display_pct_after REAL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mastery_messages_session
  ON mastery_messages(session_id, created_at);

-- Event log for analytics + cost telemetry. This is what product will query
-- to ask "what's our per-session spend". Not shown to the user.
CREATE TABLE IF NOT EXISTS mastery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES mastery_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subtopic_id UUID REFERENCES mastery_subtopics(id),

  event_type TEXT NOT NULL
    CHECK (event_type IN ('parse', 'teach_served', 'question_served',
                          'answer', 'explain_served', 'socratic_probe',
                          'socratic_reply', 'heartbeat', 'mastery_reached')),

  -- For kind='answer'
  question_id UUID REFERENCES mastery_questions(id),
  was_correct BOOLEAN,
  time_to_answer_ms INTEGER,

  -- AI cost telemetry (set on any event that spent Claude tokens)
  ai_model TEXT,
  ai_cost_micro_usd INTEGER,
  ai_input_tokens INTEGER,
  ai_output_tokens INTEGER,

  -- Mastery snapshot right after this event
  p_mastery_after REAL,
  p_pass_after REAL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mastery_events_session
  ON mastery_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mastery_events_question
  ON mastery_events(user_id, question_id) WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mastery_events_cost
  ON mastery_events(created_at) WHERE ai_cost_micro_usd IS NOT NULL;

ALTER TABLE mastery_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mastery_sessions_select_own"
  ON mastery_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "mastery_messages_select_own"
  ON mastery_messages FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM mastery_sessions
      WHERE mastery_sessions.id = mastery_messages.session_id
        AND mastery_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "mastery_events_select_own"
  ON mastery_events FOR SELECT USING (auth.uid() = user_id);
-- All writes server-side via supabaseAdmin.

-- Relax coin_transactions type constraint to allow 'mastery_session' rewards.
-- Matches the pattern from migration 016 (relax_constraints). If the CHECK
-- already allows the new value (constraint has been relaxed upstream), this
-- block is a no-op thanks to IF EXISTS logic around DROP.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'coin_transactions' AND constraint_name = 'coin_transactions_type_check'
  ) THEN
    ALTER TABLE coin_transactions DROP CONSTRAINT coin_transactions_type_check;
  END IF;
  ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_type_check
    CHECK (type IN (
      'signup_bonus', 'quiz_reward', 'duel_win', 'duel_loss', 'streak_bonus',
      'streak_milestone', 'bounty_reward', 'bounty_stake', 'badge_bonus',
      'game_reward', 'ninny_session', 'ninny_unlock', 'shop_purchase',
      'shop_refund', 'daily_bonus', 'arena_win', 'arena_loss', 'mission_reward',
      'exam_session', 'mastery_session'
    ));
END $$;
