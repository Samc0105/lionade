-- ============================================================
-- Migration 066: game_rewards — daily idempotent claim for score-game rewards.
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY: /api/games/reward credited Fangs on every POST with NO daily cap and NO
-- idempotency (raw read-modify-write), so a script could mint thousands of
-- Fangs/min in a loop — the single largest uncontrolled inflation source. This
-- table makes each score game (roardle / blitz / flashcards / timeline) pay at
-- most ONCE per UTC day per user, via an INSERT-first claim.
--
-- NOT covered here: Pardy. It already has per-tile idempotency
-- (pardy_tile_claims, INSERT-first on (user_id, tile_id)) and credits through
-- /api/games/pardy/submit, never /api/games/reward. The stale `pardy_correct`
-- entry is removed from /api/games/reward in the same change.
--
-- SECURITY: service-role only. The route uses supabaseAdmin (RLS bypass). RLS is
-- enabled with NO policies so authenticated/anon can never read or write it.

create table if not exists game_rewards (
  user_id       uuid not null references profiles(id) on delete cascade,
  game_type     text not null,
  reward_date   date not null,
  awarded_fangs integer not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, game_type, reward_date)
);

create index if not exists idx_game_rewards_user_date
  on game_rewards (user_id, reward_date);

alter table game_rewards enable row level security;

revoke all on game_rewards from anon;
revoke all on game_rewards from authenticated;
grant all on game_rewards to service_role;
