-- Migration 047: Subject stats RPC (Phase C of data-loading fix)
--
-- Replaces the client-side aggregation in lib/db.ts:getSubjectStats() with a
-- single Postgres GROUP BY. The old path SELECT'd up to 500 rows (5000 for the
-- Profile lifetime variant) and aggregated in JS — round trip + payload was
-- ~150-300ms on a warm Dashboard load and the network payload was ~95% wasted
-- (we sent N quiz_sessions rows just to compute SUM() per subject).
--
-- New path: ONE call to get_subject_stats(p_user_id, p_lifetime) returns one
-- row per subject. Same shape as the JS aggregator. Cache key in lib/hooks.ts
-- (`subject-stats/${userId}/${lifetime}`) is unchanged so Phase B's persisted
-- SWR cache continues to hit.
--
-- Index coverage: migration 039 already added
--   idx_quiz_sessions_user_completed (user_id, completed_at DESC)
--   idx_quiz_sessions_user_subject   (user_id, subject)
-- The lifetime variant uses the user_id-leading index and walks the user's
-- entire history (rare — only the Profile page). The windowed variant adds a
-- `completed_at >= now() - 90d` predicate; the (user_id, completed_at DESC)
-- composite handles it directly. No new index needed.
--
-- Security model:
--   SECURITY INVOKER (the default). The RPC executes with the caller's
--   privileges, so the existing RLS policy `quiz_sessions_owner`
--   (auth.uid() = user_id) still enforces ownership. We do NOT use
--   SECURITY DEFINER — there is no legitimate cross-user read here, and
--   SECURITY DEFINER on an RPC that takes p_user_id is a classic RLS
--   bypass footgun.
--
-- Idempotency: CREATE OR REPLACE FUNCTION. Safe to re-run.

-- ════════════════════════════════════════════════════════════════════════
-- get_subject_stats(p_user_id uuid, p_lifetime boolean)
-- ════════════════════════════════════════════════════════════════════════
-- Returns one row per subject the user has played, aggregated across the
-- relevant time window:
--   * p_lifetime = false → trailing 90-day window (Dashboard default)
--   * p_lifetime = true  → all-time (Profile page)
--
-- Column identifiers are quoted camelCase to match the JS return shape
-- exactly, so callers can drop the JS aggregate without remapping fields.
CREATE OR REPLACE FUNCTION public.get_subject_stats(
  p_user_id uuid,
  p_lifetime boolean DEFAULT false
)
RETURNS TABLE (
  subject text,
  "questionsAnswered" integer,
  "correctAnswers" integer,
  "coinsEarned" integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    qs.subject,
    COALESCE(SUM(qs.total_questions), 0)::integer AS "questionsAnswered",
    COALESCE(SUM(qs.correct_answers), 0)::integer AS "correctAnswers",
    COALESCE(SUM(qs.coins_earned),    0)::integer AS "coinsEarned"
  FROM public.quiz_sessions qs
  WHERE qs.user_id = p_user_id
    AND (
      p_lifetime
      OR qs.completed_at >= (now() - interval '90 days')
    )
  GROUP BY qs.subject;
$$;

-- Lock down execution to authenticated callers only. anon users have no
-- quiz_sessions to read (RLS would block them anyway) so revoking is
-- defense-in-depth.
REVOKE ALL ON FUNCTION public.get_subject_stats(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subject_stats(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subject_stats(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.get_subject_stats(uuid, boolean) IS
  'Per-subject aggregation of quiz_sessions for a single user. SECURITY INVOKER — relies on RLS policy quiz_sessions_owner. Used by lib/db.ts:getSubjectStats (Dashboard + Profile + Quiz select).';

-- Verify
SELECT 'get_subject_stats() created' AS status;
