-- ════════════════════════════════════════════════════════════════════════
-- HELD MIGRATION: do NOT apply until Sam gives the go.
-- TechHub / LionDesk ranked board for the three shared deterministic modes.
--
-- Purpose: a server-authoritative leaderboard for Daily Combo, Daily Chaos, and
-- the Weekly Challenge. These modes are seeded so every player gets the exact
-- same shift in a given period, which is what makes a fair ranking possible. The
-- board ranks GRADES and SCORES only. It never touches the economy: no Fangs are
-- read, written, or granted here. Fang rewards stay owned by the shift
-- completions ledger + its API route (20260626120000), which is server-clamped.
--
-- One row per (user, mode, period_key), holding that player's BEST score for the
-- period plus its derived letter grade. The API route
-- (app/api/techhub/leaderboard) owns the period key (current UTC day for the two
-- dailies, the weekSeed value for the weekly so the bucket rolls over on the same
-- boundary as the shift seed) and derives the grade from the clamped score
-- server-side, so a crafted client can never plant a fake grade or back-date a
-- period. WRITES go through the service role in that route; there is deliberately
-- NO client insert/update policy.
--
-- While this migration is HELD, the route detects the missing table and answers
-- with { liveYet: false } so the Board UI shows a clean "goes live soon" preview
-- instead of erroring. Nothing about the live game depends on it being applied.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.techhub_leaderboard (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  mode         text not null check (mode in ('combo', 'chaos', 'weekly')),
  period_key   text not null,
  best_score   int  not null default 0 check (best_score between 0 and 100),
  best_grade   text not null default 'D' check (best_grade in ('S', 'A', 'B', 'C', 'D')),
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, mode, period_key)
);

alter table public.techhub_leaderboard enable row level security;

-- Players may read their own standing. The full ranked board is read by the API
-- route through the service role (which also owns the period key + grade), and
-- all WRITES go through that route, so there is deliberately NO client
-- insert/update policy. This keeps direct client table access locked down while
-- the route stays the single validated entry point.
drop policy if exists "techhub_leaderboard_owner_read" on public.techhub_leaderboard;
create policy "techhub_leaderboard_owner_read"
  on public.techhub_leaderboard
  for select using (auth.uid() = user_id);

-- Ranking reads scan one (mode, period_key) bucket and order by best_score, so
-- index that bucket. Score is part of the ordering, not the lookup, so a plain
-- composite on the bucket keys is enough for the planner to range-scan + sort.
create index if not exists idx_techhub_leaderboard_period
  on public.techhub_leaderboard(mode, period_key, best_score desc);

create index if not exists idx_techhub_leaderboard_user
  on public.techhub_leaderboard(user_id);
