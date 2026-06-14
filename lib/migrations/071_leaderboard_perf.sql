-- ============================================================
-- Migration 071: leaderboard performance.
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY:
-- (1) competitive_elo / squad_elo (added in migration 054, after the 039 index
--     sweep) have NO index, so every Competitive/Squad ladder open full-table
--     sorts profiles. Partial indexes on the public set serve the ranked query.
-- (2) getLeaderboard fetched EVERY weekly quiz_reward coin_transactions row with
--     no limit, then aggregated in Node — a sequential scan growing linearly
--     with platform activity, on the dashboard hot path. A partial time index +
--     a bounded GROUP BY RPC move the aggregation server-side and cap it.

create index if not exists idx_profiles_competitive_elo
  on profiles (competitive_elo desc) where profile_visibility = 'public';

create index if not exists idx_profiles_squad_elo
  on profiles (squad_elo desc) where profile_visibility = 'public';

create index if not exists idx_profiles_arena_elo
  on profiles (arena_elo desc) where profile_visibility = 'public';

create index if not exists idx_coin_tx_quiz_reward_time
  on coin_transactions (created_at desc) where type = 'quiz_reward';

-- Bounded weekly-quiz leaderboard aggregation. Returns the top p_limit users by
-- summed quiz_reward Fangs since p_since, excluding p_exclude (the demo account).
-- The caller still fetches profiles + applies the visibility / opt-out filter,
-- so this only changes WHERE the aggregation runs (Postgres, bounded) — not the
-- privacy model. SECURITY DEFINER so it aggregates across users without exposing
-- raw coin_transactions to the client.
create or replace function public.weekly_quiz_leaderboard(
  p_since timestamptz,
  p_limit integer,
  p_exclude uuid
)
returns table (user_id uuid, coins_this_week bigint)
language sql
stable
security definer
set search_path = public
as $$
  select user_id, sum(amount)::bigint as coins_this_week
  from coin_transactions
  where type = 'quiz_reward'
    and created_at >= p_since
    and user_id <> p_exclude
  group by user_id
  order by coins_this_week desc
  limit greatest(1, p_limit);
$$;

revoke execute on function public.weekly_quiz_leaderboard(timestamptz, integer, uuid) from public, anon;
grant execute on function public.weekly_quiz_leaderboard(timestamptz, integer, uuid) to authenticated, service_role;
