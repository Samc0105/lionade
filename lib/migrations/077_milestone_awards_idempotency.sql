-- ============================================================
-- Migration 077: user_milestone_awards — atomic idempotency for streak milestone
-- bonuses. Applied to production via Supabase MCP. Fully idempotent; safe to
-- re-run.
-- ============================================================
--
-- WHY: save-quiz-results awards a one-time bonus at 3/7/14/30-day streak
-- milestones (50/150/500/2000 Fangs). The guard was a read-then-write: COUNT the
-- coin_transactions rows LIKE '%N-day%' and award only if zero. Two quiz submits
-- racing (different attempt_ids, e.g. two tabs) can BOTH see count=0 before
-- either inserts, and BOTH credit the milestone — a real money double-credit (up
-- to 2000 Fangs becomes 4000). The attempt_id replay guard does NOT help here:
-- these are two LEGITIMATE distinct submissions, not a replay.
--
-- FIX: a claim table whose PRIMARY KEY (user_id, milestone_day) is the lock. The
-- route INSERTs the claim FIRST; only the submit whose insert actually creates
-- the row (no 23505 conflict) credits the bonus. Concurrent submits conflict and
-- skip. This also replaces the fuzzy LIKE match (which had a latent
-- '%7-day%' matches '17-day' false-positive) with an exact integer key.
--
-- Service-role only (written exclusively by the server route). RLS on + no
-- policy = deny-all for anon/authenticated, matching the other claim tables
-- (game_rewards, reward_claims, flagged_content).

create table if not exists user_milestone_awards (
  user_id       uuid not null references profiles(id) on delete cascade,
  milestone_day integer not null,
  awarded_at    timestamptz not null default now(),
  primary key (user_id, milestone_day)
);

alter table user_milestone_awards enable row level security;
revoke all on user_milestone_awards from anon;
revoke all on user_milestone_awards from authenticated;
grant all on user_milestone_awards to service_role;
