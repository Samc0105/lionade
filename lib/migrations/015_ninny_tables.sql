-- Ninny: AI study companion
-- Materials, sessions, wrong-answer memory, and chat history

CREATE TABLE IF NOT EXISTS ninny_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'text', 'topic')),
  raw_content TEXT,
  generated_content JSONB NOT NULL,
  subject TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ninny_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES ninny_materials(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('flashcards', 'match', 'mcq', 'fill', 'tf', 'ordering', 'blitz')),
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  coins_earned INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ninny_wrong_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES ninny_materials(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  miss_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, material_id, question_text)
);

CREATE TABLE IF NOT EXISTS ninny_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ninny_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ninny_materials_user ON ninny_materials(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ninny_sessions_user ON ninny_sessions(user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ninny_sessions_material ON ninny_sessions(material_id);
CREATE INDEX IF NOT EXISTS idx_ninny_wrong_answers_lookup ON ninny_wrong_answers(user_id, material_id, miss_count DESC);
CREATE INDEX IF NOT EXISTS idx_ninny_chat_session ON ninny_chat_messages(session_id, created_at);

-- RLS
ALTER TABLE ninny_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE ninny_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ninny_wrong_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ninny_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ninny_materials_select" ON ninny_materials FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ninny_materials_insert" ON ninny_materials FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ninny_materials_update" ON ninny_materials FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ninny_materials_delete" ON ninny_materials FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "ninny_sessions_select" ON ninny_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ninny_sessions_insert" ON ninny_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ninny_wrong_answers_select" ON ninny_wrong_answers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ninny_wrong_answers_insert" ON ninny_wrong_answers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ninny_wrong_answers_update" ON ninny_wrong_answers FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "ninny_chat_select" ON ninny_chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ninny_chat_insert" ON ninny_chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
