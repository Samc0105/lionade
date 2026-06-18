-- 081_lock_question_bank_read.sql
-- SECURITY (high): public.questions (31k rows incl. correct_answer + explanation) and
-- public.arena_match_questions had an RLS policy USING(true) for role `public`, so the
-- shipped anon key could dump the entire answer bank over PostgREST with NO account,
-- bypassing every Next.js auth gate + rate limit. Lock both down. The load-bearing fix
-- is the GRANT revoke (no grant => PostgREST denies regardless of policy); the policy
-- drops are hygiene.
--   - questions: authenticated-only SELECT. iOS reads it via the user's token
--     (lib/quiz.ts: fetchQuizQuestions selects WITHOUT correct_answer, checkAnswer reads
--     correct_answer one-at-a-time). Web/arena server routes use service_role and bypass
--     RLS. anon: no access. Demo quiz is hardcoded; no client-side .from('questions') exists.
--   - arena_match_questions: service-role-only (no authenticated/anon reader — web uses
--     supabaseAdmin, iOS never touches it). Mirrors the already-safe question_bank.
-- Also revokes the inert anon/authenticated WRITE grants (dead under RLS, removed for
-- least privilege), and re-revokes EXECUTE on guard_profiles_privileged_columns (migration
-- 078's CREATE OR REPLACE silently reset it to PUBLIC, undoing 076b).
--
-- RESIDUAL (tracked, NOT fixed here — needs co-shipped iOS+web change): an authenticated
-- user can still read questions via their token, and correct_answer is sent to the client
-- for client-side scoring. Full fix = server-mediated answer checking so correct_answer
-- never leaves the server. See IOS_PARITY / security backlog.

-- ── questions: authenticated-only read ──────────────────────────────────
drop policy if exists "Questions are readable by everyone" on public.questions;
drop policy if exists "questions_select_all" on public.questions;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'questions'
      and policyname = 'questions_select_authenticated'
  ) then
    create policy questions_select_authenticated
      on public.questions for select to authenticated using (true);
  end if;
end $$;

revoke all on table public.questions from anon;
revoke insert, update, delete, truncate, references, trigger on table public.questions from authenticated;
grant select on table public.questions to authenticated;

-- ── arena_match_questions: service-role only ────────────────────────────
drop policy if exists "arena_match_questions_select" on public.arena_match_questions;
drop policy if exists "arena_match_questions are readable by everyone" on public.arena_match_questions;
revoke all on table public.arena_match_questions from anon;
revoke all on table public.arena_match_questions from authenticated;

-- ── DB hygiene: re-revoke direct RPC on the privileged-columns guard trigger fn ──
revoke execute on function public.guard_profiles_privileged_columns() from anon, authenticated, public;
