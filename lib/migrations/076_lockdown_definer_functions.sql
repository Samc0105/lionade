-- ============================================================
-- Migration 076: lock down SECURITY DEFINER functions + pin mutable search_path.
-- Hardening surfaced by the Supabase database linter (security advisors).
-- STATUS: APPLIED to production 2026-06-14 (after Sam's explicit go). Idempotent
-- (REVOKE / ALTER ... SET are safe to re-run). All call sites were verified
-- server-only before the REVOKEs (see PART A note), so this does NOT break the
-- app. NOTE: guard_profile_equipped is a trigger function whose EXECUTE was held
-- via the implicit PUBLIC role, so its revoke includes `public` (the others had
-- explicit anon/authenticated grants).
-- ============================================================
--
-- PART A — Revoke public EXECUTE on server-only SECURITY DEFINER functions.
-- These 9 functions are called EXCLUSIVELY server-side via the service-role
-- client (verified: grant_* via lib/cosmetic-grants + mastery/login-bonus
-- routes; presence via lib/presence + the heartbeat route; reap via its cron;
-- guard_profile_equipped is a trigger). The service role bypasses grants, so the
-- app is unaffected — but today a signed-in (or anonymous) user can hit
-- /rest/v1/rpc/<fn> directly and, because these run as SECURITY DEFINER, e.g.
-- self-grant cosmetic badges, trigger the AFK reaper, or spoof another user's
-- presence. Revoking anon + authenticated EXECUTE closes those vectors.
-- (lint 0028/0029 anon|authenticated_security_definer_function_executable.)

revoke execute on function public.grant_polyglot_badge(p_user_id uuid) from anon, authenticated;
revoke execute on function public.grant_knowledge_sharer_badge(p_user_id uuid) from anon, authenticated;
revoke execute on function public.grant_streak_emblem(p_user_id uuid, p_streak_days integer) from anon, authenticated;
revoke execute on function public.grant_mastery_medal(p_user_id uuid, p_exam_id uuid, p_exam_name text) from anon, authenticated;
revoke execute on function public.reap_afk_presence() from anon, authenticated;
revoke execute on function public.set_active_session(p_user_id uuid, p_type text, p_id text, p_role text) from anon, authenticated;
revoke execute on function public.clear_active_session(p_user_id uuid) from anon, authenticated;
revoke execute on function public.ping_presence(p_user_id uuid, p_type text, p_id text) from anon, authenticated;
revoke execute on function public.guard_profile_equipped() from public, anon, authenticated;

-- NOT revoked (deliberately): current_app_role(), clone_bank(...), and
-- weekly_quiz_leaderboard(...) may be intentionally client-callable (role
-- checks / self-service clone / public leaderboard read) — left for a separate
-- verified pass so we don't break a live client RPC.

-- PART B — Pin the mutable search_path on the 6 flagged functions.
-- A mutable search_path on a function (especially SECURITY DEFINER ones like
-- handle_new_user) is a hardening gap: a caller-controlled search_path can
-- redirect unqualified object references. We pin to `public` (NOT empty — these
-- bodies reference public tables unqualified, so empty would break them). This
-- only sets the GUC; it does NOT change any function body or logic.
-- (lint 0011 function_search_path_mutable.)

alter function public.calc_level_from_xp(total_xp integer) set search_path = public;
alter function public.class_assignments_touch_updated_at() set search_path = public;
alter function public.on_profile_xp_change() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.vocab_banks_derive_slug() set search_path = public;
alter function public.vocab_words_touch_updated_at() set search_path = public;
