-- ============================================================
-- Migration 083: Streak Freeze (streak insurance) — a Fang-purchased item that
-- auto-protects the daily streak when a user misses a day.
-- STATUS: HELD — write only, Sam applies manually. The feature code is designed
-- to FAIL SOFT if this migration is not yet applied (a select of the unknown
-- column errors -> the buy route reports "coming soon"; the auto-consume branch
-- treats a missing/zero counter as "no freeze" and falls through to the normal
-- streak reset, exactly as today).
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE); safe to re-run.
-- ============================================================
--
-- WHY: streak insurance is a healthy Fang SINK + a retention lever. A user who
-- misses a day loses their whole streak today (see /api/streak/expire, which
-- zeroes the streak once last_activity_at is > 36h old). With a freeze in the
-- bank, that lapse is auto-covered: one freeze is consumed and the streak is
-- preserved, instead of resetting to 0.
--
-- STORAGE — two new profiles columns:
--   streak_freezes            int  — how many freezes the user has banked.
--   last_freeze_consumed_date date — the UTC day a freeze was last auto-consumed.
--
-- The second column is the IDEMPOTENCY guard for auto-consume. The expiry route
-- is called on every page load once the streak is stale (Navbar effect), so
-- without a guard a user refreshing the page could burn multiple freezes for the
-- SAME lapse. We stamp last_freeze_consumed_date = today when we consume, and
-- refuse to consume again on the same UTC day. One lapse (however many days the
-- user was gone) consumes exactly ONE freeze.
--
-- Both columns are SERVER-MANAGED (written only via supabaseAdmin / service
-- role in /api/streak/freeze and /api/streak/expire). The guard trigger from
-- migration 080 (guard_profiles_privileged_columns) does an early `return new`
-- for service_role, so service writes to these columns are allowed WITHOUT
-- adding them to the denylist. We still add them to the denylist below so a
-- future re-grant of profiles UPDATE to `authenticated` can't let a client
-- mint themselves free freezes (defense in depth, matches the xp/streak guard).

alter table profiles
  add column if not exists streak_freezes integer not null default 0;

alter table profiles
  add column if not exists last_freeze_consumed_date date;

-- Never let the counter go negative (belt-and-suspenders; the app clamps too).
alter table profiles
  drop constraint if exists profiles_streak_freezes_nonneg;
alter table profiles
  add constraint profiles_streak_freezes_nonneg check (streak_freezes >= 0);

-- Extend the privileged-column guard so streak_freezes / last_freeze_consumed_date
-- are server-managed (client PATCH blocked; service_role still allowed via the
-- early return at the top of the function). CREATE OR REPLACE keeps the trigger
-- binding intact.
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
     or new.xp is distinct from old.xp
     or new.level is distinct from old.level
     or new.streak is distinct from old.streak
     or new.max_streak is distinct from old.max_streak
     or new.last_activity_at is distinct from old.last_activity_at
     or new.daily_questions_completed is distinct from old.daily_questions_completed
     or new.daily_reset_date is distinct from old.daily_reset_date
     -- Migration 083 additions (streak insurance):
     or new.streak_freezes is distinct from old.streak_freezes
     or new.last_freeze_consumed_date is distinct from old.last_freeze_consumed_date
  then
    raise exception 'forbidden: protected profile columns are server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
