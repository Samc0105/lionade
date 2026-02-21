-- ============================================================
-- LIONADE — Full Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Profiles ────────────────────────────────────────────────
-- Extends auth.users — auto-created on signup via trigger
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  coins        INTEGER NOT NULL DEFAULT 0,
  streak       INTEGER NOT NULL DEFAULT 0,
  max_streak   INTEGER NOT NULL DEFAULT 0,
  xp           INTEGER NOT NULL DEFAULT 0,
  level        INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Questions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id             TEXT PRIMARY KEY,
  subject        TEXT NOT NULL CHECK (subject IN ('Math','Science','Languages','SAT/ACT','Coding','Finance','Certifications')),
  question       TEXT NOT NULL,
  options        JSONB NOT NULL,
  correct_answer INTEGER NOT NULL,
  difficulty     TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  coin_reward    INTEGER NOT NULL DEFAULT 20,
  explanation    TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Quiz Sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  total_questions  INTEGER NOT NULL,
  correct_answers  INTEGER NOT NULL DEFAULT 0,
  coins_earned     INTEGER NOT NULL DEFAULT 0,
  xp_earned        INTEGER NOT NULL DEFAULT 0,
  streak_bonus     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User Answers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_answers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions(id),
  selected_answer INTEGER,
  is_correct      BOOLEAN NOT NULL DEFAULT FALSE,
  time_left       INTEGER NOT NULL DEFAULT 0,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Daily Activity (Streak tracking) ────────────────────────
CREATE TABLE IF NOT EXISTS daily_activity (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date                DATE NOT NULL DEFAULT CURRENT_DATE,
  questions_answered  INTEGER NOT NULL DEFAULT 0,
  coins_earned        INTEGER NOT NULL DEFAULT 0,
  streak_maintained   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, date)
);

-- ── Duels ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duels (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenger_id     UUID NOT NULL REFERENCES profiles(id),
  opponent_id       UUID NOT NULL REFERENCES profiles(id),
  subject           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed','declined')),
  challenger_score  INTEGER NOT NULL DEFAULT 0,
  opponent_score    INTEGER NOT NULL DEFAULT 0,
  winner_id         UUID REFERENCES profiles(id),
  coins_wagered     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- ── Duel Answers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duel_answers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  duel_id         UUID NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id),
  question_id     TEXT NOT NULL REFERENCES questions(id),
  selected_answer INTEGER,
  is_correct      BOOLEAN NOT NULL DEFAULT FALSE,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Badges ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT NOT NULL,
  rarity      TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User Badges ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_badges (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id  TEXT NOT NULL REFERENCES badges(id),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

-- ── Coin Transactions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coin_transactions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount       INTEGER NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('quiz_reward','duel_win','duel_loss','streak_bonus','badge_bonus','signup_bonus')),
  reference_id TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_id ON quiz_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_completed_at ON quiz_sessions(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_answers_session_id ON user_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date ON daily_activity(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_duels_challenger ON duels(challenger_id);
CREATE INDEX IF NOT EXISTS idx_duels_opponent ON duels(opponent_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_id ON coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_created_at ON coin_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_coins ON profiles(coins DESC);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE duels ENABLE ROW LEVEL SECURITY;
ALTER TABLE duel_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;

-- Questions & badges are public read
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, only owner can update
CREATE POLICY "profiles_public_read" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_owner_update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_owner_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Questions: public read
CREATE POLICY "questions_public_read" ON questions FOR SELECT USING (true);

-- Badges: public read
CREATE POLICY "badges_public_read" ON badges FOR SELECT USING (true);

-- Quiz sessions: user owns their data
CREATE POLICY "quiz_sessions_owner" ON quiz_sessions FOR ALL USING (auth.uid() = user_id);

-- User answers: user owns their data
CREATE POLICY "user_answers_owner" ON user_answers FOR ALL USING (
  session_id IN (SELECT id FROM quiz_sessions WHERE user_id = auth.uid())
);

-- Daily activity: user owns their data
CREATE POLICY "daily_activity_owner" ON daily_activity FOR ALL USING (auth.uid() = user_id);

-- Duels: participants can see their duels
CREATE POLICY "duels_participants" ON duels FOR ALL USING (
  auth.uid() = challenger_id OR auth.uid() = opponent_id
);

-- Duel answers: participants can see them
CREATE POLICY "duel_answers_participants" ON duel_answers FOR ALL USING (
  duel_id IN (SELECT id FROM duels WHERE challenger_id = auth.uid() OR opponent_id = auth.uid())
);

-- User badges: public read, owner insert
CREATE POLICY "user_badges_public_read" ON user_badges FOR SELECT USING (true);
CREATE POLICY "user_badges_owner_insert" ON user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Coin transactions: owner only
CREATE POLICY "coin_transactions_owner" ON coin_transactions FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, display_name, avatar_url, coins)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'https://api.dicebear.com/7.x/avataaars/svg?seed=' || encode(NEW.id::text::bytea, 'base64') || '&backgroundColor=4A90D9',
    100  -- signup bonus coins
  );

  -- Log signup bonus
  INSERT INTO coin_transactions (user_id, amount, type, description)
  VALUES (NEW.id, 100, 'signup_bonus', 'Welcome to Lionade! 🎉');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update level based on XP
CREATE OR REPLACE FUNCTION update_level()
RETURNS TRIGGER AS $$
BEGIN
  NEW.level := GREATEST(1, FLOOR(NEW.xp / 1000) + 1);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER on_profile_xp_change
  BEFORE UPDATE OF xp ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_level();

-- ============================================================
-- SEED DATA — Badges
-- ============================================================
INSERT INTO badges (id, name, description, icon, rarity) VALUES
  ('b1', 'First Blood',   'Complete your first quiz',               '🎯', 'common'),
  ('b2', 'On Fire',       'Maintain a 7-day streak',                '🔥', 'rare'),
  ('b3', 'Math Wizard',   'Score 100% on 5 math quizzes',           '🧮', 'epic'),
  ('b4', 'Duel King',     'Win 10 duels in a row',                  '⚔️', 'legendary'),
  ('b5', 'Coin Hoarder',  'Accumulate 10,000 coins',                '💰', 'epic'),
  ('b6', 'Speed Demon',   'Answer 5 questions under 5s each',       '⚡', 'rare'),
  ('b7', 'Poly Grind',    'Complete quizzes in 5 different subjects','📚', 'rare'),
  ('b8', 'Night Owl',     'Study after midnight 3 times',           '🦉', 'common')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SEED DATA — Questions
-- ============================================================
INSERT INTO questions (id, subject, question, options, correct_answer, difficulty, coin_reward, explanation) VALUES

-- MATH
('m1','Math','If f(x) = 3x² - 2x + 1, what is f''(x)?','["6x - 2","3x - 2","6x + 1","3x² - 2"]',0,'medium',30,'The derivative of 3x² is 6x, and the derivative of -2x is -2.'),
('m2','Math','What is the sum of the interior angles of a hexagon?','["540°","720°","900°","360°"]',1,'medium',25,'(n-2) × 180° = (6-2) × 180° = 720°'),
('m3','Math','Solve: 2x + 5 = 17','["x = 4","x = 6","x = 7","x = 5"]',1,'easy',15,NULL),
('m4','Math','What is log₂(64)?','["4","5","6","8"]',2,'medium',30,'2⁶ = 64, so log₂(64) = 6'),
('m5','Math','Probability of rolling two dice and getting a sum of 7?','["1/6","1/8","5/36","7/36"]',0,'medium',35,'There are 6 ways to get 7 out of 36 total outcomes = 6/36 = 1/6'),
('m6','Math','What is the determinant of [[3, 1], [2, 4]]?','["10","12","14","8"]',0,'hard',50,'(3×4) - (1×2) = 12 - 2 = 10'),
('m7','Math','What is the value of i² where i = √(-1)?','["1","-1","i","-i"]',1,'easy',20,NULL),
('m8','Math','Solve: |3x - 6| = 12','["x = 6","x = -2","x = 6 or x = -2","x = 2 or x = -6"]',2,'medium',35,NULL),
('m9','Math','What is the area of a circle with radius 7?','["44π","49π","14π","21π"]',1,'easy',15,NULL),
('m10','Math','What is the limit of (sin x)/x as x→0?','["0","∞","1","undefined"]',2,'hard',50,NULL),

-- SCIENCE
('s1','Science','What is the powerhouse of the cell?','["Nucleus","Ribosome","Mitochondria","Golgi apparatus"]',2,'easy',15,NULL),
('s2','Science','What is Newton''s second law of motion?','["F = mv","F = ma","F = m/a","F = v/t"]',1,'easy',20,'Force equals mass times acceleration (F = ma)'),
('s3','Science','What is the atomic number of Carbon?','["4","6","8","12"]',1,'easy',15,NULL),
('s4','Science','What type of bond shares electrons equally?','["Ionic","Metallic","Nonpolar covalent","Polar covalent"]',2,'medium',30,NULL),
('s5','Science','What wavelength range is visible light?','["400-700 nm","100-400 nm","700-1000 nm","1-100 nm"]',0,'medium',30,NULL),
('s6','Science','What is Avogadro''s number?','["6.02 × 10²³","3.14 × 10²³","6.02 × 10²²","1.38 × 10²³"]',0,'easy',20,NULL),
('s7','Science','Which planet has the most moons?','["Jupiter","Saturn","Uranus","Neptune"]',1,'medium',25,'Saturn has 146 confirmed moons, surpassing Jupiter.'),
('s8','Science','What is the pH of pure water at 25°C?','["6","7","8","Depends on pressure"]',1,'easy',15,NULL),
('s9','Science','What does DNA stand for?','["Deoxyribonucleic Acid","Dinucleic Acid","Deoxyribose Nucleotide Acid","Dinucleotide Acid"]',0,'easy',15,NULL),
('s10','Science','What is the speed of light in a vacuum?','["3 × 10⁸ m/s","3 × 10⁶ m/s","3 × 10¹⁰ m/s","9 × 10⁸ m/s"]',0,'easy',20,NULL),

-- LANGUAGES
('l1','Languages','What is the Spanish word for butterfly?','["Mariposa","Flor","Pájaro","Estrella"]',0,'easy',15,NULL),
('l2','Languages','Which language has the most native speakers worldwide?','["English","Spanish","Mandarin Chinese","Hindi"]',2,'easy',15,NULL),
('l3','Languages','What is the French phrase for I love you?','["Je t''aime","Je vous aime","Je t''adore","Both A and B"]',3,'medium',25,NULL),
('l4','Languages','What writing system does Japanese use?','["Only Kanji","Only Hiragana","Hiragana, Katakana, and Kanji","Only Katakana"]',2,'medium',30,NULL),
('l5','Languages','Which language family does Arabic belong to?','["Indo-European","Semitic","Sino-Tibetan","Turkic"]',1,'medium',30,NULL),
('l6','Languages','How many official languages does Switzerland have?','["2","3","4","5"]',2,'medium',25,'German, French, Italian, and Romansh'),
('l7','Languages','What does Carpe Diem mean in Latin?','["Seize the day","Live forever","Time flies","Follow your dreams"]',0,'easy',20,NULL),
('l8','Languages','What is the German word for butterfly?','["Schmetterling","Vogel","Blume","Sonne"]',0,'medium',25,NULL),
('l9','Languages','What is the most widely spoken Romance language?','["French","Italian","Portuguese","Spanish"]',3,'easy',20,NULL),
('l10','Languages','Which language has the most words?','["French","German","English","Japanese"]',2,'medium',25,NULL),

-- SAT/ACT
('sat1','SAT/ACT','If 3x + 7 = 22, what is the value of 6x + 5?','["30","35","40","25"]',1,'medium',30,'3x = 15, x = 5. Then 6(5) + 5 = 35'),
('sat2','SAT/ACT','What is the meaning of ephemeral?','["Long-lasting","Short-lived","Mysterious","Abundant"]',1,'medium',25,NULL),
('sat3','SAT/ACT','A car travels 240 miles in 4 hours. Average speed?','["50 mph","55 mph","60 mph","65 mph"]',2,'easy',15,NULL),
('sat4','SAT/ACT','Which sentence contains a dangling modifier?','["Running down the street, the dog barked loudly.","Running down the street, I saw the dog.","The dog, barking loudly, ran down the street.","I ran down the street, and the dog barked."]',0,'hard',45,NULL),
('sat5','SAT/ACT','A rectangle length is 3x its width. Perimeter = 48, find area.','["108","96","81","72"]',0,'hard',50,'2(3w + w) = 48 → w = 6, l = 18. Area = 18 × 6 = 108'),
('sat6','SAT/ACT','What literary device: The wind whispered through the trees?','["Metaphor","Simile","Personification","Alliteration"]',2,'easy',20,NULL),
('sat7','SAT/ACT','What is the synonym for ubiquitous?','["Rare","Omnipresent","Singular","Obscure"]',1,'medium',30,NULL),
('sat8','SAT/ACT','If a² + b² = 25 and ab = 12, what is (a + b)²?','["37","49","61","25"]',1,'hard',50,'(a+b)² = a² + 2ab + b² = 25 + 24 = 49'),
('sat9','SAT/ACT','Which correctly completes: The results were ___ than expected?','["more better","more worse","worse","worst"]',2,'medium',20,NULL),
('sat10','SAT/ACT','What percentage of 80 is 20?','["15%","20%","25%","30%"]',2,'easy',15,NULL),

-- CODING
('c1','Coding','What is the time complexity of binary search?','["O(n)","O(n²)","O(log n)","O(n log n)"]',2,'medium',35,NULL),
('c2','Coding','What does CSS stand for?','["Computer Style Sheet","Cascading Style Sheet","Creative Style System","Coded Style Sheet"]',1,'easy',15,NULL),
('c3','Coding','Which data structure uses LIFO (Last In, First Out)?','["Queue","Stack","Linked List","Tree"]',1,'easy',20,NULL),
('c4','Coding','What is a closure in JavaScript?','["A function that terminates a program","A function that has access to its outer scope variables","A function that is immediately invoked","A function without parameters"]',1,'medium',35,NULL),
('c5','Coding','What is the output of: console.log(typeof null)?','["null","undefined","object","string"]',2,'medium',30,'This is a known JavaScript quirk — typeof null returns object.'),
('c6','Coding','Which sorting algorithm has O(n log n) average complexity?','["Bubble Sort","Insertion Sort","Quick Sort","Selection Sort"]',2,'medium',35,NULL),
('c7','Coding','What does API stand for?','["Automated Programming Interface","Application Programming Interface","Advanced Protocol Integration","Application Protocol Interface"]',1,'easy',15,NULL),
('c8','Coding','What is the result of 5 === 5 in JavaScript?','["true","false","TypeError","undefined"]',1,'easy',20,'=== checks type and value. 5 is number, 5 is string — not equal.'),
('c9','Coding','Which HTTP method is used to update a resource?','["GET","POST","PUT","DELETE"]',2,'easy',20,NULL),
('c10','Coding','In Python, what is a list comprehension?','["A way to import lists from libraries","A concise way to create lists using a single expression","A method to compare two lists","A built-in function to flatten nested lists"]',1,'medium',30,NULL),

-- FINANCE
('f1','Finance','What does ROI stand for?','["Rate of Income","Return on Investment","Revenue over Investment","Risk of Inflation"]',1,'easy',15,NULL),
('f2','Finance','What is compound interest?','["Interest calculated only on the principal","Interest calculated on both principal and accumulated interest","A fixed monthly fee charged by banks","Interest that decreases over time"]',1,'easy',20,NULL),
('f3','Finance','What is a bull market?','["A market with falling prices","A market with rising prices","A market with stable prices","A market in a recession"]',1,'easy',15,NULL),
('f4','Finance','What is the P/E ratio?','["Profit to Earnings ratio","Price to Earnings ratio","Profit to Equity ratio","Principal to Expense ratio"]',1,'medium',30,NULL),
('f5','Finance','What is diversification in investing?','["Putting all money in one stock","Spreading investments across different assets","Only investing in bonds","Converting all assets to cash"]',1,'easy',20,NULL),
('f6','Finance','Invest $1000 at 10% annual compound. How much after 3 years?','["$1,300","$1,310","$1,331","$1,350"]',2,'medium',35,'1000 × (1.10)³ = 1000 × 1.331 = $1,331'),
('f7','Finance','What is a mutual fund?','["A type of savings account","A pooled investment vehicle managed by professionals","A government bond","A loan from multiple banks"]',1,'medium',25,NULL),
('f8','Finance','What does liquidity refer to in finance?','["The amount of debt a company has","How easily an asset can be converted to cash","The interest rate on loans","The total value of a company"]',1,'medium',30,NULL),
('f9','Finance','What is inflation?','["Decrease in general price levels","Increase in general price levels over time","A rise in stock market prices","Decrease in unemployment"]',1,'easy',15,NULL),
('f10','Finance','What is the rule of 72?','["A tax regulation for retirement accounts","A rule to estimate years to double your investment at a given rate","A formula for calculating loan payments","A guideline for stock market investing"]',1,'medium',35,'Divide 72 by the annual interest rate to estimate years to double money.'),

-- CERTIFICATIONS
('cert1','Certifications','What does AWS stand for?','["Advanced Web Services","Amazon Web Services","Automated Web Systems","Applied Web Solutions"]',1,'easy',15,NULL),
('cert2','Certifications','What does the CIA triad stand for in cybersecurity?','["Control, Integrity, Access","Confidentiality, Integrity, Availability","Cyber, Information, Access","Confidentiality, Information, Authorization"]',1,'medium',30,NULL),
('cert3','Certifications','What is the OSI model?','["Open System Interconnection model — a 7-layer network framework","Operating System Interface model","Online Security Integration model","Open Source Infrastructure model"]',0,'medium',35,NULL),
('cert4','Certifications','Which CompTIA certification focuses on cybersecurity?','["CompTIA A+","CompTIA Network+","CompTIA Security+","CompTIA Cloud+"]',2,'easy',20,NULL),
('cert5','Certifications','What does HTTPS stand for?','["Hyper Text Transfer Protocol Secure","High Transfer Text Protocol System","Hyper Transfer Text Protocol Security","High Text Transfer Protocol Secure"]',0,'easy',15,NULL),
('cert6','Certifications','What is a VPN?','["Virtual Private Network","Very Protected Node","Virtual Public Network","Verified Private Network"]',0,'easy',15,NULL),
('cert7','Certifications','What type of attack overwhelms a server with traffic?','["Phishing","SQL Injection","DDoS","Man-in-the-Middle"]',2,'medium',30,NULL),
('cert8','Certifications','What does SQL stand for?','["Structured Query Language","System Query Language","Sequential Query Logic","Structured Queue Logic"]',0,'easy',15,NULL),
('cert9','Certifications','What is the purpose of a firewall?','["Speed up internet connection","Monitor and control incoming/outgoing network traffic","Encrypt all data transmissions","Manage user accounts"]',1,'easy',20,NULL),
('cert10','Certifications','What does DNS stand for?','["Dynamic Network System","Domain Name System","Direct Network Service","Data Node Server"]',1,'easy',15,NULL)

ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- WAITLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  source     TEXT,
  referrer   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Waitlist: only service role can insert/read (via API route)
CREATE POLICY "waitlist_service_only" ON waitlist
  FOR ALL USING (false)
  WITH CHECK (false);
