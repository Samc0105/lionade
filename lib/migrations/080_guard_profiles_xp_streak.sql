-- ============================================================
-- Migration 080: tighten the profiles column guard (078 Phase 2) to also cover
-- xp / level / streak / max_streak / last_activity_at / daily_*.
-- STATUS: APPLIED to production 2026-06-14, AFTER the Phase-2 code deploy went
-- live (verified the new /api/streak/expire route was serving before applying).
-- Functionally verified: authenticated xp + streak self-grants BLOCKED; legit
-- display_name edit ALLOWED; service_role xp/streak writes (main quiz, etc.)
-- ALLOWED. Idempotent (CREATE OR REPLACE).
-- ============================================================
--
-- 078 deliberately left these unguarded because two legacy web flows still wrote
-- them from the browser. Those moved server-side in the same change set, so this
-- extends the denylist. All legitimate writers are now service_role (save-quiz-
-- results, complete-stage, streak/expire, login-bonus, streak-revive), which the
-- guard allows. `level` is only ever set by the on_profile_xp_change trigger
-- from xp; guarding it is safe (a client xp write is blocked before level
-- matters; a service xp write is allowed and carries the level change through).

create or replace function public.guard_profiles_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

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
     -- Phase 2 additions (progression + daily counters):
     or new.xp is distinct from old.xp
     or new.level is distinct from old.level
     or new.streak is distinct from old.streak
     or new.max_streak is distinct from old.max_streak
     or new.last_activity_at is distinct from old.last_activity_at
     or new.daily_questions_completed is distinct from old.daily_questions_completed
     or new.daily_reset_date is distinct from old.daily_reset_date
  then
    raise exception 'forbidden: protected profile columns are server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
