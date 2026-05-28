-- Migration 054: Competitive Modes — the unified PvP arena platform.
--
-- Web-only build per CEO scope override 2026-05-28. iOS port paused; Poker Face
-- iOS additionally held pending ios-security-auditor 5.3 review (see IOS_PARITY).
-- Spec locked at ~/.claude/projects/-Users-samc-Desktop-lionade/memory/project_competitive_modes.md.
--
-- This is the schema substrate for FIVE new competitive modes — Sabotage Trivia,
-- Zoom Reveal, Spectrum Slider, Map Pin Drop, Poker Face — each playable 1v1 AND
-- 2v2. All five share one unified `competitive_matches` table and one shared
-- completion endpoint. Per-mode round/state tables hang off the match.
--
-- ELO strategy (locked, data-economist):
--   - profiles.competitive_elo (1v1) + profiles.squad_elo (2v2), both default
--     1000, K=32. Legacy profiles.arena_elo is UNTOUCHED — different skill
--     surface; merging would corrupt both ladders.
--   - Per-mode mastery is cosmetic (badges/streaks), NOT separate ELO — 10
--     ladders = 10 dead queues at low DAU.
--
-- Daily loss cap (locked):
--   - ONE shared cap across all competitive modes + legacy Arena. The
--     `competitive_matches.fang_delta` jsonb feeds lib/arena-v2/loss-cap.ts
--     which now sums arena_matches + competitive_matches for the 24h window.
--
-- RLS:
--   - All tables enable RLS. SELECT allowed for any authenticated user (matches
--     are joinable by both participants and visible for spectating/history).
--     INSERT/UPDATE/DELETE go ONLY through the service role inside
--     /api/competitive/* route handlers — no client write policies.

-- ── profiles: the two new ELO ladders ─────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS competitive_elo int NOT NULL DEFAULT 1000;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS squad_elo int NOT NULL DEFAULT 1000;

-- ── competitive_matches — the UNIFIED match record (all 5 modes, both formats) ──
-- team_a / team_b hold the player UUIDs. In 1v1 each array has one element; in
-- 2v2 each has two. winner_team is 'a' | 'b' | 'draw' | null (null = in progress).
-- elo_before / elo_after / fang_delta are per-user jsonb maps keyed by user_id.
CREATE TABLE IF NOT EXISTS competitive_matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode          text NOT NULL,                       -- sabotage | zoom | spectrum | pin | pokerface
  format        text NOT NULL DEFAULT '1v1',         -- 1v1 | 2v2
  status        text NOT NULL DEFAULT 'queued',      -- queued | active | completed
  team_a        uuid[] NOT NULL DEFAULT '{}',
  team_b        uuid[] NOT NULL DEFAULT '{}',
  winner_team   text,                                -- a | b | draw | null
  elo_before    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { "<user_id>": 1000, ... }
  elo_after     jsonb NOT NULL DEFAULT '{}'::jsonb,
  fang_delta    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { "<user_id>": -30, ... } signed
  wager         int NOT NULL DEFAULT 0,              -- Poker Face: opening stake; others 0
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_competitive_matches_status
  ON competitive_matches(mode, format, status);
CREATE INDEX IF NOT EXISTS idx_competitive_matches_team_a
  ON competitive_matches USING gin (team_a);
CREATE INDEX IF NOT EXISTS idx_competitive_matches_team_b
  ON competitive_matches USING gin (team_b);
CREATE INDEX IF NOT EXISTS idx_competitive_matches_completed
  ON competitive_matches(completed_at DESC) WHERE status = 'completed';

ALTER TABLE competitive_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competitive_matches_select ON competitive_matches;
CREATE POLICY competitive_matches_select ON competitive_matches
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── competitive_queue — matchmaking ───────────────────────────────────
-- One row per waiting user. mode NULL = "any mode". party_code groups a 2v2
-- duo (friends who joined the same 4-digit code before queuing). elo is the
-- ladder rating snapshot used for the ±band matcher.
CREATE TABLE IF NOT EXISTS competitive_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  format      text NOT NULL DEFAULT '1v1',           -- 1v1 | 2v2
  mode        text,                                  -- specific mode, or NULL for any
  elo         int NOT NULL DEFAULT 1000,
  party_code  text,                                  -- 2v2 duo grouping (4-digit), NULL for solo
  joined_at   timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'waiting',       -- waiting | matched | cancelled
  match_id    uuid REFERENCES competitive_matches(id) ON DELETE SET NULL,
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_competitive_queue_search
  ON competitive_queue(format, status, elo) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_competitive_queue_party
  ON competitive_queue(party_code) WHERE party_code IS NOT NULL;

ALTER TABLE competitive_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competitive_queue_select ON competitive_queue;
CREATE POLICY competitive_queue_select ON competitive_queue
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Sabotage Trivia — rounds + attacks ────────────────────────────────
CREATE TABLE IF NOT EXISTS sabotage_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES competitive_matches(id) ON DELETE CASCADE,
  round_num      int NOT NULL,
  question       text NOT NULL,
  options        jsonb NOT NULL,                     -- shuffled array of 4 strings
  correct_index  int NOT NULL,
  category       text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  UNIQUE (match_id, round_num)
);

CREATE INDEX IF NOT EXISTS idx_sabotage_rounds_match
  ON sabotage_rounds(match_id, round_num);

ALTER TABLE sabotage_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sabotage_rounds_select ON sabotage_rounds;
CREATE POLICY sabotage_rounds_select ON sabotage_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Attacks are persisted for audit/replay; the LIVE delivery is via Supabase
-- broadcast (see lib/competitive/channels.ts). This row is the durable record.
CREATE TABLE IF NOT EXISTS sabotage_attacks (
  id              bigserial PRIMARY KEY,
  match_id        uuid NOT NULL REFERENCES competitive_matches(id) ON DELETE CASCADE,
  attacker_id     uuid NOT NULL REFERENCES profiles(id),
  target_id       uuid NOT NULL REFERENCES profiles(id),
  kind            text NOT NULL,                     -- blur | scramble | drain | decoy | freeze | fog
  cost            int NOT NULL DEFAULT 0,
  fired_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sabotage_attacks_match
  ON sabotage_attacks(match_id, fired_at);

ALTER TABLE sabotage_attacks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sabotage_attacks_select ON sabotage_attacks;
CREATE POLICY sabotage_attacks_select ON sabotage_attacks
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Zoom Reveal — rounds ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zoom_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES competitive_matches(id) ON DELETE CASCADE,
  round_num      int NOT NULL,
  image_url      text NOT NULL,
  answer         text NOT NULL,
  aliases        jsonb NOT NULL DEFAULT '[]'::jsonb,
  reveal_sec     int NOT NULL DEFAULT 15,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  UNIQUE (match_id, round_num)
);

CREATE INDEX IF NOT EXISTS idx_zoom_rounds_match
  ON zoom_rounds(match_id, round_num);

ALTER TABLE zoom_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zoom_rounds_select ON zoom_rounds;
CREATE POLICY zoom_rounds_select ON zoom_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Spectrum Slider — rounds ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spectrum_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES competitive_matches(id) ON DELETE CASCADE,
  round_num      int NOT NULL,
  prompt         text NOT NULL,
  true_value     double precision NOT NULL,
  min_value      double precision NOT NULL,
  max_value      double precision NOT NULL,
  unit           text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  UNIQUE (match_id, round_num)
);

CREATE INDEX IF NOT EXISTS idx_spectrum_rounds_match
  ON spectrum_rounds(match_id, round_num);

ALTER TABLE spectrum_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spectrum_rounds_select ON spectrum_rounds;
CREATE POLICY spectrum_rounds_select ON spectrum_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Map Pin Drop — rounds ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pin_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES competitive_matches(id) ON DELETE CASCADE,
  round_num      int NOT NULL,
  prompt         text NOT NULL,
  true_lat       double precision NOT NULL,
  true_lng       double precision NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  UNIQUE (match_id, round_num)
);

CREATE INDEX IF NOT EXISTS idx_pin_rounds_match
  ON pin_rounds(match_id, round_num);

ALTER TABLE pin_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pin_rounds_select ON pin_rounds;
CREATE POLICY pin_rounds_select ON pin_rounds
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Poker Face — hands ────────────────────────────────────────────────
-- The "hand" is one presentation round. presenter_id draws a card, picks
-- truth or lie, sets an opening stake (and optionally ONE bounded raise),
-- and the caller (the opponent) calls believe/doubt. Settlement is zero-sum.
-- card_word + card_fact are the curated card; claim_text is the (possibly
-- invented) statement the presenter actually showed.
CREATE TABLE IF NOT EXISTS pokerface_hands (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid NOT NULL REFERENCES competitive_matches(id) ON DELETE CASCADE,
  hand_num        int NOT NULL,
  presenter_id    uuid NOT NULL REFERENCES profiles(id),
  caller_id       uuid NOT NULL REFERENCES profiles(id),
  card_word       text NOT NULL,
  card_fact       text NOT NULL,
  claim_text      text,                              -- what the presenter showed (truth or invented lie)
  is_truth        boolean,                           -- did the presenter present the real fact?
  opening_stake   int NOT NULL DEFAULT 0,
  raise_amount    int NOT NULL DEFAULT 0,            -- bounded single raise (0 = none)
  total_stake     int NOT NULL DEFAULT 0,            -- opening + raise (the per-side exposure)
  caller_call     text,                              -- believe | doubt | null
  winner_id       uuid REFERENCES profiles(id),
  phase           text NOT NULL DEFAULT 'present',   -- present | call | reveal | done
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  UNIQUE (match_id, hand_num)
);

CREATE INDEX IF NOT EXISTS idx_pokerface_hands_match
  ON pokerface_hands(match_id, hand_num);

ALTER TABLE pokerface_hands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pokerface_hands_select ON pokerface_hands;
CREATE POLICY pokerface_hands_select ON pokerface_hands
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Realtime publication ──────────────────────────────────────────────
-- Add the match + round tables so clients get phase transitions automatically.
-- Sabotage ATTACKS are delivered via broadcast (high-frequency, peer-routed),
-- NOT postgres_changes — same lesson as the party-realtime doc. So
-- sabotage_attacks stays OUT of the publication (it's a durable audit record
-- only). sabotage_rounds IS in (round-advance is low-frequency state).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'competitive_matches',
    'competitive_queue',
    'sabotage_rounds',
    'zoom_rounds',
    'spectrum_rounds',
    'pin_rounds',
    'pokerface_hands'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END$$;
