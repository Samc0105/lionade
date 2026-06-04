-- Pardy tile-claim ledger.
--
-- WHY: Security review flagged 2026-06-04 that /api/games/pardy/submit
-- granted Fangs on every correct answer without persisting per-user-
-- per-tile claim state. A user could submit the same correct answer
-- for the same tile repeatedly and farm unlimited Fangs. Plus the
-- route was doing read-modify-write on profiles.coins (the same race
-- pattern we killed across other routes via update_user_coins).
--
-- This table tracks every (user, tile) claim with a UNIQUE PK so the
-- route can INSERT-FIRST and only grant Fangs if the insert succeeded
-- (PostgREST returns a 23505 unique_violation on dupes). Failure to
-- insert short-circuits the reward path; replay returns the same
-- "correct" response WITHOUT awarding again. Idempotent + race-safe.

begin;

create table if not exists public.pardy_tile_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tile_id text not null,
  awarded_fangs integer not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, tile_id)
);

create index if not exists pardy_tile_claims_user_idx
  on public.pardy_tile_claims (user_id, claimed_at desc);

-- RLS: owner-only SELECT for analytics + transparency ("show me my
-- past Pardy claims"). No INSERT/UPDATE/DELETE policies — only the
-- service-role server route writes (via supabaseAdmin), and the PK
-- enforces uniqueness regardless of client-side state.
alter table public.pardy_tile_claims enable row level security;

drop policy if exists pardy_tile_claims_select_own on public.pardy_tile_claims;
create policy pardy_tile_claims_select_own
  on public.pardy_tile_claims
  for select
  to authenticated
  using (user_id = auth.uid());

-- Service role bypasses RLS for INSERT — that's the server route's job.

commit;
