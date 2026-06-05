-- 20260605220000_ai_call_log.sql
--
-- 12-factor agents Factor 2 (own your prompts) + Factor 9 (compact errors)
-- moved from console.info logs to a queryable table. One row per OpenAI call
-- made by Lionade's server-side AI surfaces. Lets ops queries like:
--
--   -- did parse quality drop after the 2026-06-10 prompt edit?
--   SELECT prompt_version, AVG(success::int)
--   FROM ai_call_log WHERE route = 'mastery/parse'
--   GROUP BY prompt_version;
--
--   -- how much have we spent on resume coach this week?
--   SELECT SUM(cost_micro_usd) / 1000000.0 AS usd
--   FROM ai_call_log
--   WHERE route LIKE 'coach/resume/%' AND created_at > NOW() - INTERVAL '7 days';
--
-- Schema notes:
--   - user_id NULL for anonymous calls (none today, but reserves room).
--   - error_short bounded to 200 chars — full traces stay in console; this
--     column is for "what kind of error" grouping, not debugging.
--   - input_tokens / output_tokens / cost_micro_usd populated even on failed
--     calls when OpenAI billed us (e.g. schema-validation throw after the
--     model already returned).
--   - route is a short label like "mastery/parse" or "ninny/chat" — keeps
--     queries readable and small index entries.
--   - prompt_version uses the convention `vN-YYYY-MM-DD`.

CREATE TABLE IF NOT EXISTS ai_call_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  route         TEXT NOT NULL CHECK (char_length(route) <= 80),
  prompt_version TEXT NOT NULL CHECK (char_length(prompt_version) <= 32),
  model         TEXT NOT NULL CHECK (char_length(model) <= 40),
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  success       BOOLEAN NOT NULL,
  error_short   TEXT CHECK (error_short IS NULL OR char_length(error_short) <= 200),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes pick the two query patterns we know we'll run.
CREATE INDEX IF NOT EXISTS ai_call_log_route_created_idx
  ON ai_call_log (route, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_call_log_user_created_idx
  ON ai_call_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- RLS: writes happen via supabaseAdmin (service-role) only. No client reads.
-- Lock the table down so a forged JWT can't read or write rows. Ops queries
-- run from the Supabase SQL editor under the service-role-bypass.
ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;
-- No policies = no anon/authenticated access. Service role bypasses RLS.

COMMENT ON TABLE ai_call_log IS '12-factor agent telemetry: one row per server-side AI call. Service-role writes only.';
