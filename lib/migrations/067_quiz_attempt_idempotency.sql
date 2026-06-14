-- ============================================================
-- Migration 067: quiz_sessions.attempt_id — idempotency for the core earn path.
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY: /api/save-quiz-results had no replay protection — a retried POST (network
-- retry, double-tap) re-inserted a session and re-credited up to 500 Fangs.
-- A client-supplied attempt_id + a partial UNIQUE(user_id, attempt_id) makes the
-- INSERT the idempotency gate: a replay hits 23505 and the route returns the
-- prior result WITHOUT re-crediting. (The bet-resolution double-credit is fixed
-- in the same change via a conditional resolved_at claim.)
--
-- The unique index is PARTIAL (attempt_id IS NOT NULL) so legacy rows and any
-- old-client submit without an attempt_id (NULL) are unaffected — only new
-- submits that carry an id are deduped. Genuine separate quizzes carry distinct
-- ids and still each earn.

alter table quiz_sessions add column if not exists attempt_id uuid;

create unique index if not exists uq_quiz_sessions_user_attempt
  on quiz_sessions (user_id, attempt_id)
  where attempt_id is not null;
