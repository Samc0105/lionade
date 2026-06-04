-- Resume Coach (Pro-tier exclusive)
--
-- Per-user persistence for the chat-style resume-critique flow:
--   1. User uploads a PDF; server extracts text via pdf-parse v2 (same
--      pattern as /api/classes/[id]/syllabus and /api/games/pdf).
--   2. gpt-4o-mini returns strengths[5] + weaknesses[5] + questions[7]
--      where each question pins to one specific resume bullet.
--   3. Per-question Socratic exchange: user types a response, AI rewrites
--      the bullet, user accepts/rejects/counters. Each answer is appended
--      to analysis_json.answers[].
--   4. Final view exports markdown of "Original / Improved" pairs.
--
-- The full session lives in a SINGLE jsonb column (analysis_json) — we
-- never query into it from the DB, only read it whole + write it whole
-- per Socratic turn. Splitting answers into a separate table would buy
-- nothing here.
--
-- RLS: owner-only — a user can read and mutate ONLY their own sessions.
-- No public read, no cross-user joins anywhere; this is private career
-- coaching data.

create table if not exists resume_coach_sessions (
  id           uuid          primary key default gen_random_uuid(),
  user_id      uuid          not null references profiles(id) on delete cascade,
  resume_text  text          not null,
  analysis_json jsonb        not null,
  created_at   timestamptz   not null default now()
);

create index if not exists resume_coach_sessions_user_created_idx
  on resume_coach_sessions (user_id, created_at desc);

alter table resume_coach_sessions enable row level security;

-- Owner-only SELECT
drop policy if exists resume_coach_sessions_select_own on resume_coach_sessions;
create policy resume_coach_sessions_select_own
  on resume_coach_sessions
  for select
  using (auth.uid() = user_id);

-- Owner-only INSERT
drop policy if exists resume_coach_sessions_insert_own on resume_coach_sessions;
create policy resume_coach_sessions_insert_own
  on resume_coach_sessions
  for insert
  with check (auth.uid() = user_id);

-- Owner-only UPDATE (used by /answer to append a turn to analysis_json.answers[])
drop policy if exists resume_coach_sessions_update_own on resume_coach_sessions;
create policy resume_coach_sessions_update_own
  on resume_coach_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No DELETE policy on purpose: server-side admin (service-role) can still
-- delete via cascade from profiles; users don't need a delete path in V1.

comment on table resume_coach_sessions is
  'Resume Coach (Pro-tier) — one row per upload. analysis_json holds {strengths, weaknesses, questions, answers}.';
