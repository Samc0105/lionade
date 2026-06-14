-- ============================================================
-- Migration 074: profiles.streak_reminder_sent_at — idempotency marker for the
-- daily streak-at-risk re-engagement email.
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY: app/api/cron/streak-reminder fires once a day and emails users whose
-- streak is alive but about to lapse (last_activity_at 24-44h ago, so a return
-- TODAY still ticks the streak — see the 20h/48h window in save-quiz-results).
-- Without a marker, a user who stays at-risk across two cron runs (e.g. they
-- never come back) could be emailed twice for the same streak-session. The
-- guard is "send only when streak_reminder_sent_at < last_activity_at": once we
-- send we stamp now(); the moment the user studies again last_activity_at jumps
-- past the stamp, RE-ARMING the reminder for their next at-risk window. This is
-- a self-resetting gate that needs no cleanup job.
--
-- The column is written ONLY by the cron (service role). It is never
-- client-PATCHable and is intentionally NOT in the preferences blob so it can be
-- compared against last_activity_at in a single indexed predicate.

alter table profiles
  add column if not exists streak_reminder_sent_at timestamptz;

-- Partial index: the cron's candidate query filters on last_activity_at within a
-- trailing window AND streak > 0. This supports that range scan without touching
-- the (large) set of rows that have never studied.
create index if not exists idx_profiles_streak_reminder
  on profiles (last_activity_at)
  where streak > 0;
