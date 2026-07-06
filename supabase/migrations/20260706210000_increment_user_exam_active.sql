-- ============================================================================
-- increment_user_exam_active — atomic bump of user_exams.total_active_seconds
-- ============================================================================
--
-- app/api/mastery/sessions/[id]/heartbeat/route.ts has called this RPC since
-- the Mastery heartbeat shipped, but the function was never created: every
-- call returned PGRST202, and the route's client-side fallback sat in the
-- promise REJECTION handler (dead code — PostgREST errors resolve with
-- { error }, they do not reject). Net effect: user_exams.total_active_seconds
-- stayed frozen at 0 while the per-session mastery_sessions.active_seconds
-- ledger kept counting, silently zeroing every "Time to master" display
-- (/api/mastery/exams, /api/mastery/exams/[id], /api/mastery/sessions/[id],
-- /api/classes, /api/classes/[id]).
--
-- This migration:
--   1. creates the atomic counter RPC the heartbeat route expects, and
--   2. backfills total_active_seconds from SUM(mastery_sessions.active_seconds)
--      per user_exam_id, using GREATEST so re-running is safe and never
--      shrinks a value.

create or replace function public.increment_user_exam_active(
  p_user_exam_id uuid,
  p_seconds      integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_exam_id is null then
    raise exception 'p_user_exam_id required' using errcode = 'P0001';
  end if;
  -- Heartbeats credit at most 15s per beacon; anything outside (0, 3600]
  -- is a bug or a forged call, not a legitimate delta.
  if p_seconds is null or p_seconds <= 0 or p_seconds > 3600 then
    raise exception 'p_seconds out of range' using errcode = 'P0001';
  end if;

  update public.user_exams
     set total_active_seconds = coalesce(total_active_seconds, 0) + p_seconds,
         updated_at = now()
   where id = p_user_exam_id;
end;
$$;

-- Server-only counter: the heartbeat route calls it with the service role.
-- No client-side caller exists, and exposing it would let any user inflate
-- arbitrary exams' active time.
revoke execute on function public.increment_user_exam_active(uuid, integer) from public, anon, authenticated;
grant  execute on function public.increment_user_exam_active(uuid, integer) to service_role;

-- Backfill: recover the time silently lost while the RPC was missing.
-- GREATEST keeps this idempotent and non-destructive if any rows already
-- carry a value (e.g. from a manual ops fix).
update public.user_exams ue
   set total_active_seconds = greatest(coalesce(ue.total_active_seconds, 0), s.total_seconds),
       updated_at = now()
  from (
    select user_exam_id, sum(active_seconds)::integer as total_seconds
      from public.mastery_sessions
     where active_seconds > 0
     group by user_exam_id
  ) s
 where s.user_exam_id = ue.id
   and coalesce(ue.total_active_seconds, 0) < s.total_seconds;
