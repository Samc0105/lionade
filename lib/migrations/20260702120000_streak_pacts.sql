-- 20260702120000_streak_pacts.sql
-- ============================================================
-- HELD: apply manually (Sam) via the Supabase SQL editor. UNAPPLIED.
--
-- STREAK PACTS: duo accountability streaks between accepted friends.
-- A pact's joint streak advances on every UTC day where BOTH members have a
-- daily_activity row; a fully-elapsed day where either member was inactive
-- resets the joint count to 0 (upside-only: nothing else is lost). Reconcile
-- is LAZY and deterministic: GET /api/pacts replays daily_activity history
-- forward from last_both_day, so it is idempotent across tabs/retries.
--
-- Milestone Fangs (+50 at 7 both-days, +250 at 30, to BOTH members) use the
-- ledger type 'pact_milestone', which is added to the coin_transactions type
-- CHECK by 20260702090000_web_features_ledger_types.sql (also HELD). Until
-- that widening is applied the grant path fail-softs on 23514: the pact keeps
-- counting, milestone booleans stay false, and the API flags milestonePending
-- so the UI shows honest "reward on the way" copy.
--
-- FAIL-SOFT CONTRACT: every /api/pacts route catches undefined-table (42P01)
-- and undefined-column (42703) errors and reports { available: false } so the
-- feature self-hides on web until this file is applied. Nothing 500s.
--
-- Design notes:
--  * user_a < user_b (CHECK) + UNIQUE(user_a, user_b): exactly ONE row per
--    pair, ever. Ending or declining sets status='ended'; a later re-invite
--    RECYCLES the same row (streak reset, milestone booleans PRESERVED so a
--    pair can never re-farm the same milestone by re-pacting).
--  * "Up to 3 active pacts per user" is enforced in the routes (invite +
--    accept), not in SQL.
--  * last_both_day doubles as the counting CURSOR: the accept route seeds it
--    to (accept day - 1) so history from before the pact went active never
--    counts retroactively toward milestones.
--  * last_nudge_day rate-limits the partner nudge to 1/day per pact via a
--    compare-and-swap update.
--  * RLS enabled with NO policies: service-role only. All reads/writes go
--    through /api/pacts/* on supabaseAdmin.

create table if not exists streak_pacts (
  id                   uuid primary key default gen_random_uuid(),
  user_a               uuid not null references profiles(id) on delete cascade,
  user_b               uuid not null references profiles(id) on delete cascade,
  invited_by           uuid not null references profiles(id) on delete cascade,
  status               text not null default 'pending'
                         check (status in ('pending', 'active', 'ended')),
  current_streak       int  not null default 0,
  best_streak          int  not null default 0,
  last_both_day        date,
  last_nudge_day       date,
  milestone_7_granted  boolean not null default false,
  milestone_30_granted boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint streak_pacts_pair_ordered check (user_a < user_b),
  constraint streak_pacts_pair_unique unique (user_a, user_b)
);

alter table streak_pacts enable row level security;

-- Membership lookups filter on status <> 'ended' (list, invite dedupe, caps),
-- so partial indexes keep them cheap without indexing the ended graveyard.
create index if not exists idx_streak_pacts_user_a_live
  on streak_pacts (user_a) where status <> 'ended';
create index if not exists idx_streak_pacts_user_b_live
  on streak_pacts (user_b) where status <> 'ended';
