-- ══════════════════════════════════════════════════
-- The Lion's Den — Shop Tables
-- ══════════════════════════════════════════════════

-- User inventory (owned items: cosmetics + boosters)
CREATE TABLE IF NOT EXISTS user_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('frame', 'background', 'name_color', 'banner', 'booster')),
  quantity INTEGER NOT NULL DEFAULT 1,
  equipped BOOLEAN NOT NULL DEFAULT false,
  rarity TEXT CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  acquired_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user ON user_inventory(user_id);

-- Purchase history log
CREATE TABLE IF NOT EXISTS purchase_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_name TEXT,
  item_type TEXT,
  rarity TEXT,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  purchased_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_history_user ON purchase_history(user_id);

-- Active boosters (consumed during quiz)
CREATE TABLE IF NOT EXISTS active_boosters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  booster_effect TEXT NOT NULL,
  booster_value NUMERIC NOT NULL DEFAULT 1,
  uses_remaining INTEGER NOT NULL DEFAULT 1,
  activated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_active_boosters_user ON active_boosters(user_id);

-- RLS Policies
ALTER TABLE user_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_boosters ENABLE ROW LEVEL SECURITY;

-- Users can read their own inventory
CREATE POLICY "Users read own inventory" ON user_inventory
  FOR SELECT USING (auth.uid() = user_id);

-- Users can read their own purchase history
CREATE POLICY "Users read own purchases" ON purchase_history
  FOR SELECT USING (auth.uid() = user_id);

-- Users can read their own active boosters
CREATE POLICY "Users read own boosters" ON active_boosters
  FOR SELECT USING (auth.uid() = user_id);

-- Service role (used by API routes) bypasses RLS automatically
