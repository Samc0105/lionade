-- Migration 062: Party secret-column REVOKE + FORCE RLS parity hardening.
--
-- ⚠️ NOT YET APPLIED — Sam runs this manually.
--
-- Context: migration 061 (Trivia) added a column-level REVOKE on the secret
-- trivia_rounds.correct_index so authenticated/anon roles can't read the win
-- condition directly via PostgREST or realtime before the reveal phase. The
-- already-live party tables from migration 051 have the IDENTICAL pre-existing
-- hole and never got the same treatment:
--
--   • bluff_rounds.correct_answer — the truth answer. Readable by any
--     authenticated user via PostgREST/realtime during the write+vote phases,
--     bypassing the API's reveal-gating. Lets a player both (a) know the answer
--     to vote correctly and (b) craft a perfect bluff.
--   • sketch_rounds.word — the drawer's secret word/phrase. Readable by any
--     authenticated guesser via PostgREST/realtime, defeating the entire game.
--
-- Both tables are in the supabase_realtime publication (051), so the secret
-- currently ships in every change payload.
--
-- Safety check (done before writing this): grepped the whole repo for any
-- BROWSER/client-side `.from("bluff_rounds")` / `.from("sketch_rounds")` select.
-- There are NONE — all reads go through /api/party/* route handlers using
-- supabaseAdmin (service_role), which a column REVOKE does NOT affect. The
-- client party views (BluffView / SketchView) use the supabase client ONLY for
-- .channel() realtime broadcast/postgres_changes, never .from() table reads, and
-- the page.tsx postgres_changes subscriptions target only party_rooms /
-- party_room_players. So revoking the secret columns from authenticated/anon is
-- safe and breaks nothing.
--
-- Also: 051 only ENABLEd RLS on bluff_rounds + sketch_rounds, never FORCEd it
-- (Trivia's 061 FORCEs). FORCE makes the table owner subject to RLS too — a
-- small hardening-parity gap the security review flagged. Added below.

-- ── Secret-column REVOKEs ─────────────────────────────────────────────
-- service_role retains access (REVOKE only targets authenticated + anon), so
-- every API route that scores/reveals via supabaseAdmin keeps working.
REVOKE SELECT (correct_answer) ON bluff_rounds FROM authenticated, anon;
REVOKE SELECT (word) ON sketch_rounds FROM authenticated, anon;

-- ── FORCE RLS parity ──────────────────────────────────────────────────
ALTER TABLE bluff_rounds FORCE ROW LEVEL SECURITY;
ALTER TABLE sketch_rounds FORCE ROW LEVEL SECURITY;
