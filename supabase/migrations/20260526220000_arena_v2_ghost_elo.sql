-- Migration 050: Arena V2 — ghost-owner offline ELO buffer (Phase 3).
--
-- Implements Option B of the locked ELO conservation decision (2026-05-26):
-- each real-ghost match produces a symmetric +/- ELO update so the rating
-- pool stays conserved. The LIVE player gets their delta immediately at
-- /api/arena/v2/complete; the GHOST owner is offline, so their delta is
-- buffered on profiles.pending_elo_change and applied on next login when
-- they tap the Claim card.
--
-- Why a buffer instead of writing arena_elo straight away:
--   1. On-login summary makes the rating change a delight-or-sting moment
--      in-app rather than a silent background mutation the user never
--      notices.
--   2. The summary array gives us a transparent audit ("Your ghost ran 6
--      duels: 4W 2L. ELO: 1500 -> 1512") that ratings purists demand.
--   3. The Claim button is the consent surface — even though ELO is just
--      rating math (no Fang/value transfer, no legal exposure), the user
--      always gets to SEE what changed before it lands.
--
-- Trainer Ninny matches are EXCLUDED from this conservation system by
-- design (see project_arena_v2_decisions.md "ELO conservation"): the
-- trainer-ninny profile never receives a pending update because trainer
-- matches inject/absorb ELO from outside the player pool, bounded by the
-- per-user cap (first 3 duels OR 24h).
--
-- Capping the summary at 50 entries (FIFO eviction at the API layer) keeps
-- the JSONB row size bounded for users who go away for a long time and
-- come back to find their ghost was hammered.
--
-- All columns NOT NULL DEFAULT 0/'[]' so the read path is fearless — no
-- COALESCE noise downstream. Backfill is a no-op for existing rows
-- (defaults populate on ADD COLUMN IF NOT EXISTS).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pending_elo_change int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_elo_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_wins int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_losses int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_draws int NOT NULL DEFAULT 0;

COMMENT ON COLUMN profiles.pending_elo_change IS
  'Arena V2: ghost-owner offline ELO buffer; applied on login claim via POST /api/arena/v2/claim-ghost-elo.';
COMMENT ON COLUMN profiles.pending_elo_summary IS
  'Arena V2: ghost-owner offline buffer; per-match audit entries (capped at 50, FIFO). Shape: [{ match_id, challenged_at, challenger_anon_handle, subject, outcome, elo_delta }]. Applied on login claim.';
COMMENT ON COLUMN profiles.pending_wins IS
  'Arena V2: ghost-owner offline buffer; arena_wins increment applied on login claim.';
COMMENT ON COLUMN profiles.pending_losses IS
  'Arena V2: ghost-owner offline buffer; arena_losses increment applied on login claim.';
COMMENT ON COLUMN profiles.pending_draws IS
  'Arena V2: ghost-owner offline buffer; arena_draws increment applied on login claim.';
