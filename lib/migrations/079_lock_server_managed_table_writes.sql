-- ============================================================
-- Migration 079: revoke client WRITE access on server-managed gameplay/economy
-- tables (the systemic sibling of 078's profiles fix).
-- STATUS: *** READY, NOT YET APPLIED — awaiting Sam's explicit go. ***
-- Idempotent (drop-if-exists before every create).
-- ============================================================
--
-- WHY: the same class of hole 078 fixed on `profiles` exists across the
-- gameplay/economy tables. Each has a permissive policy (auth.uid()=user_id,
-- no with_check) letting a logged-in user UPDATE/INSERT/DELETE their OWN rows
-- straight from the browser anon key. Exploits:
--   active_boosters  -> set uses_remaining=9999 / expires_at=far-future
--                       => permanent streak shields + boosters
--   user_inventory   -> insert/own legendary cosmetics + boosters for free,
--                       set quantity=9999
--   user_bounties /
--   user_daily_missions -> set completed=true, claimed=false => the server
--                       reward route then credits REAL Fangs for work not done
--   daily_bets       -> set won=true / coins_won=99999 / resolved_at=null
--   daily_spins / purchase_history / user_stats / achievements /
--   user_stage_progress / user_path_progress / daily_drill_progress /
--   daily_progress -> tamper progress, stats, spin cooldown, purchase audit.
--
-- VERIFIED SAFE: every one of these tables is written ONLY by the server via
-- supabaseAdmin (which BYPASSES RLS, so this migration cannot affect a single
-- legitimate write). NO anon-client path writes any of them (audited lib/*.ts,
-- *.tsx, server components; lib/db.ts saveStageProgress is dead, only referenced
-- in comments). Some ARE read by the anon client (lib/hooks active_boosters;
-- lib/db daily_bets / achievements / user_bounties), so we PRESERVE SELECT and
-- only remove write access.
--
-- SHAPE: tables whose single policy was cmd=ALL (read+write) are replaced with a
-- SELECT-only policy (same auth.uid()=user_id predicate). Tables that already
-- have a separate SELECT policy just have their INSERT/UPDATE/DELETE policies
-- dropped. Result: clients can READ their own rows, only the server can write.
--
-- NOT applied: like 078 this is a live RLS change on shared tables — held for
-- Sam's explicit go. Pairs with 078 to close the whole client-tamper surface.

-- ── ALL-policy tables: replace "manage own rows" with "read own rows" ──
drop policy if exists "achievements_owner" on public.achievements;
drop policy if exists "achievements_select_own" on public.achievements;
create policy "achievements_select_own" on public.achievements for select using (auth.uid() = user_id);

drop policy if exists "boosters_owner" on public.active_boosters;
drop policy if exists "active_boosters_select_own" on public.active_boosters;
create policy "active_boosters_select_own" on public.active_boosters for select using (auth.uid() = user_id);

drop policy if exists "daily_bets_owner" on public.daily_bets;
drop policy if exists "daily_bets_select_own" on public.daily_bets;
create policy "daily_bets_select_own" on public.daily_bets for select using (auth.uid() = user_id);

drop policy if exists "daily_spins_owner" on public.daily_spins;
drop policy if exists "daily_spins_select_own" on public.daily_spins;
create policy "daily_spins_select_own" on public.daily_spins for select using (auth.uid() = user_id);

drop policy if exists "purchases_owner" on public.purchase_history;
drop policy if exists "purchase_history_select_own" on public.purchase_history;
create policy "purchase_history_select_own" on public.purchase_history for select using (auth.uid() = user_id);

drop policy if exists "user_bounties_owner" on public.user_bounties;
drop policy if exists "user_bounties_select_own" on public.user_bounties;
create policy "user_bounties_select_own" on public.user_bounties for select using (auth.uid() = user_id);

drop policy if exists "inventory_owner" on public.user_inventory;
drop policy if exists "user_inventory_select_own" on public.user_inventory;
create policy "user_inventory_select_own" on public.user_inventory for select using (auth.uid() = user_id);

drop policy if exists "Users manage their own progress" on public.user_path_progress;
drop policy if exists "user_path_progress_select_own" on public.user_path_progress;
create policy "user_path_progress_select_own" on public.user_path_progress for select using (auth.uid() = user_id);

-- ── Separate-policy tables: drop client write policies (SELECT-own stays) ──
drop policy if exists "daily_drill_progress_insert" on public.daily_drill_progress;
drop policy if exists "daily_drill_progress_update" on public.daily_drill_progress;
drop policy if exists "daily_drill_progress_delete" on public.daily_drill_progress;

drop policy if exists "Users upsert own daily progress" on public.daily_progress;
drop policy if exists "Users update own daily progress" on public.daily_progress;

drop policy if exists "user_daily_missions_insert" on public.user_daily_missions;
drop policy if exists "user_daily_missions_update" on public.user_daily_missions;

drop policy if exists "user_stage_progress_insert" on public.user_stage_progress;
drop policy if exists "user_stage_progress_update" on public.user_stage_progress;

drop policy if exists "Users insert own stats" on public.user_stats;
drop policy if exists "Users update own stats" on public.user_stats;
