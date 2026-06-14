-- ============================================================
-- Migration 078: BEFORE UPDATE trigger guarding privileged profile columns.
-- STATUS: *** READY, NOT YET APPLIED — awaiting Sam's explicit go. ***
-- This closes a LIVE, CRITICAL exploit (see WHY). It is a trigger on the core
-- profiles table (high blast radius), so the auto-apply classifier correctly
-- held it for an explicit decision. The fix CANNOT live in app code — the
-- exploit is direct DB access via the browser anon key that bypasses the app.
-- Verified safe: NO client code writes any guarded column (audited all 6 client
-- profiles.update sites + the db.ts helpers). Idempotent (CREATE OR REPLACE +
-- DROP/CREATE). APPLY ASAP via the Supabase SQL editor or MCP.
-- ============================================================
--
-- WHY (CRITICAL): the profiles RLS policy "Users can update own profile"
-- (cmd=UPDATE, role=public, qual auth.uid()=id, NO with_check / NO column
-- restriction) lets ANY authenticated user write ANY column of their OWN row
-- straight from the browser Supabase client:
--
--     supabase.from('profiles').update({ coins: 999999, plan: 'platinum',
--                                         role: 'admin', competitive_elo: 3000 })
--                              .eq('id', myId)
--
-- This bypasses the ENTIRE economy hardening — update_user_coins, the dual
-- ledger, the Stripe webhook, settle.ts, the admin role gate. A user could
-- self-grant unlimited Fangs, a paid tier, ADMIN, or any rank. RLS gates ROWS,
-- not COLUMNS, so a policy alone can't fix this.
--
-- FIX: a BEFORE UPDATE trigger that, for any caller that is NOT the service role
-- (i.e. the browser anon/authenticated client), rejects a change to the
-- economy / entitlement / role / rank columns. The service role (every API
-- route via supabaseAdmin, and the SECURITY DEFINER economy RPCs which run under
-- it) is allowed through, so all legitimate server writes are unaffected. We use
-- the SAME `auth.role() = 'service_role'` check update_user_coins already relies
-- on. Verified: NO client code writes any of these columns (the only client
-- profiles.update sites touch display_name / bio / avatar / presence /
-- onboarding prefs), so this breaks nothing.
--
-- SCOPE (deliberately narrow for now): xp / level / streak / max_streak /
-- last_activity_at / daily_* are NOT yet guarded, because the legacy Learning
-- Paths client flow (lib/db saveQuizSession -> incrementXP + upsertDailyActivity)
-- still writes streak + xp from the browser. Those move server-side in a
-- follow-up, after which this denylist tightens to include them. The columns
-- guarded here are the high-value money / entitlement / role / rank ones.

create or replace function public.guard_profiles_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role (API routes via supabaseAdmin + the SECURITY DEFINER economy
  -- RPCs that run under it) may change anything.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Browser client (anon / authenticated): block economy / entitlement / role /
  -- rank columns. RLS already restricts to the user's OWN row; this stops them
  -- from self-granting Fangs, a paid tier, admin, or ELO via a raw update.
  if new.coins is distinct from old.coins
     or new.fangs_cashable is distinct from old.fangs_cashable
     or new.fangs_iap is distinct from old.fangs_iap
     or new.lifetime_fangs_spent is distinct from old.lifetime_fangs_spent
     or new.plan is distinct from old.plan
     or new.subscription_tier is distinct from old.subscription_tier
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_current_period_end is distinct from old.subscription_current_period_end
     or new.subscription_cancel_at is distinct from old.subscription_cancel_at
     or new.subscription_cycle is distinct from old.subscription_cycle
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.role is distinct from old.role
     or new.arena_elo is distinct from old.arena_elo
     or new.arena_wins is distinct from old.arena_wins
     or new.arena_losses is distinct from old.arena_losses
     or new.arena_draws is distinct from old.arena_draws
     or new.competitive_elo is distinct from old.competitive_elo
     or new.squad_elo is distinct from old.squad_elo
     or new.pending_elo_change is distinct from old.pending_elo_change
     or new.pending_wins is distinct from old.pending_wins
     or new.pending_losses is distinct from old.pending_losses
     or new.pending_draws is distinct from old.pending_draws
     or new.pending_elo_summary is distinct from old.pending_elo_summary
  then
    raise exception 'forbidden: protected profile columns are server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profiles_privileged on public.profiles;
create trigger trg_guard_profiles_privileged
  before update on public.profiles
  for each row execute function public.guard_profiles_privileged_columns();
