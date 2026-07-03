# Prod Schema Drift Audit — 2026-07-03

**Method:** one read-only verifier agent per local migration file (137 files: 36 in `supabase/migrations/`, 101 in `lib/migrations/`), each probing the LIVE Supabase prod schema (information_schema, pg_catalog, storage, seed rows) and grepping the web repo for code dependencies on anything missing. The live schema was treated as the source of truth, not the history table. Run AFTER today's applies (vocab nullable-lang + the six 20260702 web-feature migrations), so those show as applied.

**Headline: 118/137 fully applied. 12 partial, 7 never applied. 1 critical, 6 high.**

Duplicates note: many features exist as BOTH a lib/ file and a supabase/ file; each was audited independently, so a gap can appear once even though two files cover the same feature.

## Needs action (ranked)


### CRITICAL — `lib/migrations/20260630120000_founder_grants_source_reference.sql` (not_applied)

**Missing:**
- public.founder_grants.source (text column)
- public.founder_grants.reference_id (text column)

**Code dependency:** app/api/stripe/webhook/route.ts lines 319-324 inserts `source` and `reference_id` into founder_grants on every Stripe subscription/purchase event (tryGrantFoundingScholar + handleCheckoutCompleted). app/api/shop/purchase/route.ts lines 301-305 inserts `source` into founder_grants on every Fang-path founder badge purchase. All three insert paths silently fail with a swallowed 42703 error, so no founder_grants row is ever written — Pro subscribers and Fang purchasers never receive their founding scholar badge in the database.

**Evidence:** Live `public.founder_grants` has exactly 5 columns (id, user_id, badge_id, granted_at, grant_reason) — neither `source` nor `reference_id` exists. No matching row in `supabase_migrations.schema_migrations` (checked both version prefix `20260630120000` and name substring `founder_grants_source`). The migration file's own comment incorrectly claimed these columns "ALREADY EXIST in production"; the live schema proves otherwise. Both PostgREST insert calls that reference these columns (stripe/webhook/route.ts:319-324 passing `source:"stripe_subscription"` + `reference_id:subscriptionId`, and shop/purchase/route.ts:301-305 passing `source:"purchase"`) will receive a `42703` column-does-not-exist error from PostgREST, which the error handlers log and swallow (only `23505` is specially handled) — meaning the INSERT itself is silently aborted and no row is written to `founder_grants`.

### HIGH — `lib/migrations/010_add_last_activity_date.sql` (not_applied)

**Missing:**
- profiles.last_activity_date (DATE column)

**Code dependency:** `/Users/samc/Desktop/lionade/app/api/mastery/sessions/[id]/answer/route.ts` — `bumpDailyStreakCounter()` (line 349) SELECTs `last_activity_date` from profiles and (line 360) writes `last_activity_date: today` on every mastery answer submission. The Supabase JS client silently ignores writes to non-existent columns, so the field is always null on read, and no streak-date guard works correctly for this code path.

**Evidence:** The single artifact — `profiles.last_activity_date DATE` — is absent from the live database (information_schema.columns returns zero rows for that column). No matching entry in supabase_migrations.schema_migrations. Migration 011 added a related-but-distinct column `last_activity_at TIMESTAMPTZ` (confirmed present in the live schema), but it does not supersede `last_activity_date`; live code in `/app/api/mastery/sessions/[id]/answer/route.ts` still SELECT-s and UPDATE-s `last_activity_date` independently of `last_activity_at`.

### HIGH — `lib/migrations/014_learning_paths.sql` (partial)

**Missing:**
- learning_paths.stage_description column (NOT NULL in migration, absent in prod)
- learning_paths.total_stages column (NOT NULL in migration, absent in prod)
- UNIQUE(subject, stage_number) constraint on learning_paths
- idx_learning_paths_subject index on learning_paths(subject, stage_number)
- Policy user_stage_progress_insert (dropped by migration 079)
- Policy user_stage_progress_update (dropped by migration 079)

**Code dependency:** lib/db.ts:1313,1315,1333,1343,1349,1351,1354,1365 selects stage_description and total_stages from learning_paths. app/learn/paths/[subject]/page.tsx:515,576,585,607 renders stage_description and total_stages in the UI. app/api/paths/complete-stage/route.ts:81 queries learning_paths. These are hot-path reads on the /learn/paths feature — any query selecting stage_description or total_stages will silently return null/undefined (Supabase returns unknown columns as null in JS client), causing the stage description to render blank and total_stages math to produce NaN in the UI.

**Evidence:** Both tables exist in prod and RLS is enabled on both. The user_stage_progress table matches the migration fully (all columns, CHECK constraint, both FKs with ON DELETE CASCADE, UNIQUE(user_id, stage_id), both indexes idx_user_stage_progress_user and idx_user_stage_progress_stage). However the learning_paths table is a diverged evolution: it is missing stage_description (defined NOT NULL in 014) and total_stages (defined NOT NULL in 014), and instead has columns description, required_score, fangs_reward, xp_reward that do not exist in 014. The UNIQUE(subject, stage_number) constraint and the idx_learning_paths_subject index are both absent. The learning_paths_select policy exists but under the name "Anyone can read learning paths" rather than "learning_paths_select". The user_stage_progress_insert and user_stage_progress_update policies are absent (migration 079 explicitly dropped them). No row exists in supabase_migrations.schema_migrations for this file. The live schema appears to be a later evolved version applied separately, not this exact file.

### HIGH — `lib/migrations/038_remove_signup_bonus.sql` (not_applied)

**Missing:**
- handle_new_user() body with coins=0 (live version still sets coins=100)
- removal of coin_transactions signup_bonus insert (live version still inserts it)

**Code dependency:** The unapplied change is a product/economy policy change, not a structural schema change. The wallet page at app/wallet/page.tsx maps signup_bonus as a known transaction type (line 45), meaning the UI expects the old behaviour. New signups still receive 100 Fangs passively at account creation instead of earning their first Fangs via the daily Clock In claim — the intended onboarding-to-engagement loop is silently bypassed for every new user. No 500-error risk, but the deliberate product mechanic (first reward requires an active tap) is not in effect in production.

**Evidence:** The live `handle_new_user()` function body (fetched via pg_proc.prosrc) inserts `coins = 100` and a `coin_transactions` row with `type = 'signup_bonus'`. Migration 038 replaces that with `coins = 0` and no transaction insert. The two bodies are unambiguously different. The schema_migrations history table has no row matching 038 or any signup-bonus/handle_new_user pattern (only an unrelated `fix_signup_trigger` row exists). The migration's distinctive change — zeroing the startup balance and dropping the coin_transactions insert — is absent from production.

### HIGH — `lib/migrations/083_streak_freeze.sql` (not_applied)

**Missing:**
- profiles.streak_freezes (integer NOT NULL DEFAULT 0)
- profiles.last_freeze_consumed_date (date)
- profiles_streak_freezes_nonneg CHECK (streak_freezes >= 0)
- guard_profiles_privileged_columns() updated body (083 additions: streak_freezes + last_freeze_consumed_date guards)

**Code dependency:** app/api/streak/freeze/route.ts — reads and writes profiles.streak_freezes on the buy path (SELECT streak_freezes, UPDATE streak_freezes). app/api/streak/expire/route.ts — reads profiles.streak_freezes and profiles.last_freeze_consumed_date on every page-load streak-expiry check (called by Navbar.tsx effect). components/StreakFreezeWidget.tsx and lib/hooks.ts also reference streak_freezes for display. The code explicitly fail-softs: the expire route catches the column-not-found error and falls through to normal streak reset; the freeze-buy route returns a "coming soon" response. So the feature is silently disabled rather than 500-ing.

**Evidence:** All three artifact probes returned empty results against the live database:
1. profiles.streak_freezes and profiles.last_freeze_consumed_date columns: absent from information_schema.columns.
2. profiles_streak_freezes_nonneg CHECK constraint: absent from pg_constraint.
3. guard_profiles_privileged_columns() function body: present but is the pre-083 version — it ends at daily_reset_date with no mention of streak_freezes or last_freeze_consumed_date, confirming the CREATE OR REPLACE in 083 was never executed.
The migration is marked "HELD — write only, Sam applies manually" in its own header comment.

### HIGH — `lib/migrations/20260626120000_techhub_shift_completions.sql` (not_applied)

**Missing:**
- table: public.techhub_shift_completions (with all columns, constraints, unique(user_id,shift_id), CHECK constraints)
- RLS enabled on public.techhub_shift_completions
- policy: techhub_shift_completions_owner_read (SELECT for auth.uid() = user_id)
- index: idx_techhub_shift_completions_user on public.techhub_shift_completions(user_id)

**Code dependency:** app/api/techhub/shifts/complete/route.ts reads and writes `techhub_shift_completions` on every POST to /api/techhub/shifts/complete. When the table is absent the route catches pg error 42P01 and returns `{ ok: false, pending: true }` instead of granting Fangs — so no 500 or data corruption, but all shift Fang rewards for every TechHub/LionDesk shift (helpdesk, soc, swe, redteam, netops, seasonal tracks) are silently suppressed until the migration is applied. Referenced in: lib/liondesk/shifts.ts, lib/liondesk/campaignProgress.ts, components/liondesk/Campaign.tsx, and four shift-definition files.

**Evidence:** 1. Table `public.techhub_shift_completions` is absent from `information_schema.tables`. 2. No row in `supabase_migrations.schema_migrations` with version `20260626120000`. 3. Index `idx_techhub_shift_completions_user` absent from `pg_indexes`. 4. Policy `techhub_shift_completions_owner_read` absent from `pg_policies`. All four probes returned 0. The migration header also self-declares "HELD — do NOT apply until Sam gives the go," confirming intentional non-application.

### HIGH — `supabase/migrations/20260603010601_stripe_subscriptions.sql` (partial)

**Missing:**
- REVOKE UPDATE (stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status, subscription_current_period_end, subscription_cancel_at, subscription_cycle) ON profiles FROM authenticated -- has_column_privilege() returns TRUE, revoke not in effect
- REVOKE UPDATE (same 7 columns) ON profiles FROM anon -- same finding

**Code dependency:** The REVOKE is a defense-in-depth hardening measure. Live code only writes these columns from server-side API routes using supabaseAdmin (which bypasses RLS and column grants anyway). The subscription page at /Users/samc/Desktop/lionade/app/settings/subscription/page.tsx reads but does not write these columns via client JWT. Multiple API routes read subscription_status for Fang multiplier logic (app/api/save-quiz-results/route.ts, app/api/login-bonus/route.ts, app/api/spin/roll/route.ts, etc.) but all via service role. The missing revoke means a logged-in user could craft a direct Supabase client UPDATE to forge their own subscription_tier to 'pro' or 'platinum' -- RLS (profiles_owner_update policy) is the only current barrier, which may or may not block billing column writes depending on its WITH CHECK clause.

**Evidence:** All DDL artifacts are present and the migration history row exists (version 20260603010601 in supabase_migrations.schema_migrations). Specifically confirmed: all 7 profiles columns (stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status, subscription_current_period_end, subscription_cancel_at, subscription_cycle) exist with correct types and defaults; all 4 check constraints plus the UNIQUE constraint on stripe_customer_id are present; the partial index idx_profiles_stripe_customer_id exists with the correct WHERE clause; stripe_webhook_events table exists with all 4 columns and RLS enabled. However, the two REVOKE UPDATE statements are NOT in effect: has_column_privilege('authenticated', 'public.profiles', 'stripe_customer_id', 'UPDATE') returns TRUE, and same for 'anon' and all 6 other billing columns. The table has a table-level UPDATE grant to both authenticated and anon, and the column-level revoke that should restrict the billing columns is absent. Migration 078_guard_profiles_privileged_columns (applied per history at 20260614202115) likely superseded or was intended to replace this revoke but has_column_privilege() still returns true, confirming the effective privilege is not locked down.

### HIGH — `supabase/migrations/20260701120000_referral_growth_loop.sql` (not_applied)

**Missing:**
- profiles.referral_code column (ALTER TABLE profiles ADD COLUMN referral_code TEXT)
- profiles_referral_code_key partial unique index on profiles(referral_code) WHERE referral_code IS NOT NULL
- referrals table (with UNIQUE(referee_id) and CHECK referrer_id <> referee_id constraints, plus referrals_referrer_idx and referrals_status_idx indexes)
- RLS policy referrals_select_own on referrals
- reward_referral(UUID) SECURITY DEFINER function
- coin_transactions_type_check updated to include referral_reward and referral_bonus types

**Code dependency:** lib/referral.ts exports ensureReferralCode, claimReferral, maybeRewardReferral, getReferralStats — all of which query profiles.referral_code or the referrals table or call reward_referral(). These are consumed by: app/api/referral/me/route.ts (GET, returns enabled:false when column missing), app/api/referral/claim/route.ts (POST, no-ops when table missing), and app/api/save-quiz-results/route.ts (calls maybeRewardReferral on quiz completion). All three paths are fail-soft — they catch PG error codes 42703/42P01/42883 and degrade gracefully — so no 500s occur. However, the entire referral growth loop is silently disabled in production: no user can obtain a referral code, no referral claim succeeds, and any attempt to write a coin_transactions row of type referral_reward or referral_bonus would hit a 23514 check_violation (the live constraint's allowlist does not include those two types).

**Evidence:** All five distinctive schema artifacts are absent from the live database: (1) profiles.referral_code column — not in information_schema.columns; (2) referrals table — not in information_schema.columns; (3) profiles_referral_code_key partial unique index — not in pg_indexes; (4) reward_referral() function — not in pg_proc; (5) no history row in supabase_migrations.schema_migrations matching the filename or any referral keyword. The coin_transactions_type_check constraint exists on the live DB but is a later version that includes focus_room_bonus/pact_milestone/set_tip_received/set_tip_sent instead — it does NOT include referral_reward or referral_bonus, so that section of the migration is also unapplied.

### MEDIUM — `lib/migrations/004_achievements_table.sql` (partial)

**Missing:**
- idx_achievements_user_id index on achievements(user_id)

**Code dependency:** app/dashboard/page.tsx reads achievements per uid via SWR (useSWR key `dashboard-achievements/${uid}`). lib/db.ts line 1162 queries achievements by user_id. app/api/save-quiz-results/route.ts line 764 inserts into achievements. All queries still function — the missing index only causes sequential scans, not errors. With a max of 8 rows per user (dashboard caps display at 8/8), the performance impact is negligible in practice.

**Evidence:** Table `achievements` exists with all 4 columns (id, user_id, achievement_key, unlocked_at). UNIQUE(user_id, achievement_key) constraint is present. RLS is enabled. Index `idx_achievements_user_id` is absent from pg_indexes. Policy `achievements_owner` (FOR ALL) is absent — it was explicitly dropped and replaced by migration 079 (`lib/migrations/079_lock_server_managed_table_writes.sql`) which created `achievements_select_own` (SELECT-only), a deliberate security tightening. No row in supabase_migrations.schema_migrations for this file (applied outside the tracked migration system). The policy absence is a supersession, not a gap; the only genuinely missing artifact is the index.

### MEDIUM — `lib/migrations/019_social_tables.sql` (partial)

**Missing:**
- idx_notifications_user ON notifications(user_id, created_at DESC)
- idx_notifications_unread ON notifications(user_id, read) WHERE read = false
- RLS policy 'notifications_select' FOR SELECT USING (auth.uid() = user_id)
- RLS policy 'notifications_update' FOR UPDATE USING (auth.uid() = user_id)

**Code dependency:** app/api/notifications/route.ts queries notifications by user_id on every request (SELECT ... FROM notifications WHERE user_id = ...) and marks rows read. Without idx_notifications_user and idx_notifications_unread, these are sequential scans on a hot path. lib/db.ts line 390 also inserts into notifications. The Navbar poll and social/page.tsx SWR hook both hit /api/notifications frequently. The 20260617120000_fk_perf_indexes.sql migration comment explicitly assumes these indexes already exist ("Existing on this table: idx_notifications_user, idx_notifications_unread"), meaning they were never added by any subsequent migration either.

**Evidence:** All four tables exist in the live DB with RLS enabled. friendships, messages, and arena_chat_events match the migration's columns, constraints, indexes, and RLS policies exactly (verified via information_schema, pg_constraint, pg_indexes, pg_policies). The notifications block is the divergence: the table predates this file (created by an earlier, unrecorded migration) so the IF NOT EXISTS DDL was a no-op, meaning the migration's notifications-specific artifacts were silently skipped. Specific deltas: (1) user_id and related_user_id FKs reference auth.users(id) in prod vs profiles(id) in the file; (2) notifications.user_id is nullable in prod vs NOT NULL in the file; (3) prod has a notifications_type_check CHECK constraint absent from the file; (4) idx_notifications_user (user_id, created_at DESC) is absent from prod; (5) idx_notifications_unread (user_id, read WHERE read=false) is absent from prod; (6) RLS policies differ: prod has one ALL-cmd policy "Users see their own notifications" instead of the file's separate notifications_select (SELECT) + notifications_update (UPDATE) policies. No migration history row exists for 019_social_tables or any social/friendship/messages/notifications-named entry in supabase_migrations.schema_migrations. The file's comment itself acknowledges the tables "were never created via a migration," confirming it was applied ad-hoc via SQL editor (for the social tables) and notifications was pre-existing.

### LOW — `lib/migrations/008_edit_profile_fields.sql` (partial)

**Missing:**
- CHECK constraint on profiles.bio: CHECK (char_length(bio) <= 150)

**Code dependency:** The bio 150-char limit is enforced in application code at /Users/samc/Desktop/lionade/app/api/user/profile-update/route.ts (slice to MAX_BIO before writing). The profile page at /Users/samc/Desktop/lionade/app/profile/page.tsx also clamps input client-side. No code path relies on the DB-level CHECK constraint — it is a defense-in-depth guard only.

**Evidence:** All three columns (bio text, education_level text, study_goal text) are present in public.profiles in the live schema. However, the CHECK (char_length(bio) <= 150) constraint is absent — a full scan of all 12 CHECK constraints on profiles shows no bio-length constraint. No migration history row exists in supabase_migrations.schema_migrations matching this file, and no counterpart exists in supabase/migrations/. The columns were applied (likely via SQL editor), but the constraint was not.

### LOW — `lib/migrations/013_arena_tables.sql` (partial)

**Missing:**
- arena_matches INSERT policy (WITH CHECK (true))
- arena_matches UPDATE policy (USING (true))
- arena_match_questions SELECT policy (USING (true))
- arena_match_questions INSERT policy (WITH CHECK (true))

**Code dependency:** All arena API routes (/Users/samc/Desktop/lionade/app/api/arena/match/route.ts, /api/arena/answer/route.ts, /api/arena/complete/route.ts) use supabaseAdmin — RLS is bypassed entirely on the server side. No client-side direct table access found. Missing policies cause no live breakage.

**Evidence:** All tables (arena_queue, arena_matches, arena_match_questions, arena_answers, arena_challenges), all 4 profiles columns (arena_elo/wins/losses/draws), all 9 indexes, RLS enabled on all 5 tables, all 3 realtime publication entries, and the cleanup_arena_queue() function are confirmed present in the live schema. The migration does NOT appear in supabase_migrations.schema_migrations under an arena-13 name (only arena_v2_ghost_elo and arena_v2_ghosts are recorded), but the live schema matches. Four RLS policies are missing: arena_matches INSERT and UPDATE policies (the migration defines them at lines 114-115) and arena_match_questions SELECT and INSERT policies (lines 118-119). All other policies for arena_queue, arena_answers, and arena_challenges are present. All arena API routes (/api/arena/match, /api/arena/answer, /api/arena/complete, etc.) use supabaseAdmin which bypasses RLS, so the missing policies have no live functional impact.

### LOW — `lib/migrations/025_daily_missions.sql` (partial)

**Missing:**
- CREATE POLICY "user_daily_missions_insert" ON user_daily_missions FOR INSERT WITH CHECK (auth.uid() = user_id)
- CREATE POLICY "user_daily_missions_update" ON user_daily_missions FOR UPDATE USING (auth.uid() = user_id)

**Code dependency:** Both write paths (/app/api/missions/progress/route.ts upsert and /app/api/missions/claim/route.ts update) use supabaseAdmin (service role), which is exempt from RLS. The missing INSERT and UPDATE policies are therefore not exercised by any live code path and cause no runtime failures.

**Evidence:** Table `user_daily_missions` exists in production with all 9 columns matching the migration exactly (uuid PK, user_id FK with CASCADE, mission_date, mission_id, progress, completed, claimed, completed_at, claimed_at). The UNIQUE constraint on (user_id, mission_date, mission_id) is present. Both named indexes (`idx_user_daily_missions_lookup` and `idx_user_daily_missions_unclaimed` with partial WHERE clause) are present. RLS is enabled (relrowsecurity=true). The SELECT policy `user_daily_missions_select` exists with correct USING clause. However, the INSERT policy `user_daily_missions_insert` and the UPDATE policy `user_daily_missions_update` are absent from pg_policies — only 1 policy found, not 3. No entry in supabase_migrations.schema_migrations for this file. The two missing write policies are non-blocking in practice: both `/api/missions/progress` (upsert) and `/api/missions/claim` (update) use `supabaseAdmin` (service role), which bypasses RLS entirely.

### LOW — `lib/migrations/046_daily_spin.sql` (partial)

**Missing:**
- policy daily_spins_owner FOR ALL (replaced by daily_spins_select_own FOR SELECT — a later migration superseded this specific artifact)

**Code dependency:** app/api/spin/roll/route.ts uses supabaseAdmin (service role) for daily_spins inserts and coin_transactions writes, bypassing RLS entirely. app/api/spin/status/route.ts reads daily_spins also via service role. The SELECT-only client-facing policy gap is not on a user-client hot path — no 500 risk or data corruption from the policy difference.

**Evidence:** Table `daily_spins` is present with all 9 columns (correct types), PK, FK to profiles with ON DELETE CASCADE, outcome CHECK constraint (all 10 values match), and index `daily_spins_user_spun_idx`. RLS is enabled. `coin_transactions_type_check` includes `daily_spin`. No migration history row in supabase_migrations.schema_migrations (applied outside the runner). One artifact differs: the migration creates policy `daily_spins_owner FOR ALL USING (auth.uid() = user_id)`, but live has `daily_spins_select_own FOR SELECT USING (auth.uid() = user_id)` only — a later migration replaced the FOR ALL policy with a SELECT-only policy.

### LOW — `lib/migrations/062_party_secret_column_revoke.sql` (partial)

**Missing:**
- ALTER TABLE bluff_rounds FORCE ROW LEVEL SECURITY
- ALTER TABLE sketch_rounds FORCE ROW LEVEL SECURITY

**Code dependency:** All bluff_rounds and sketch_rounds access is through server-side /api/party/* route handlers using supabaseAdmin (service_role), never direct client-side .from() reads. FORCE RLS would only matter if the postgres/owner role queried these tables directly, which the app does not do. The missing FORCE RLS is a hardening-parity gap (matching what migration 061 did for trivia_rounds) but not a hot-path dependency. Files referencing these tables: /Users/samc/Desktop/lionade/app/api/party/bluff/rounds/route.ts and related bluff/sketch route handlers, /Users/samc/Desktop/lionade/lib/party/bluff-advance.ts, /Users/samc/Desktop/lionade/lib/party/sketch-advance.ts, /Users/samc/Desktop/lionade/components/party/SketchView.tsx.

**Evidence:** Three artifacts audited:

1. REVOKE SELECT (correct_answer) ON bluff_rounds FROM authenticated, anon — effectively superseded/redundant: table-level SELECT is not granted to authenticated or anon on bluff_rounds (role_table_grants returns empty for SELECT on both tables for those roles), so the secret column was already unreadable via PostgREST regardless. The column-level REVOKE has no visible missing effect.

2. REVOKE SELECT (word) ON sketch_rounds FROM authenticated, anon — same situation as above; no table-level SELECT grant exists for authenticated/anon on sketch_rounds, so the column is already protected by the table-level absence of SELECT.

3. ALTER TABLE bluff_rounds FORCE ROW LEVEL SECURITY — MISSING. pg_class shows rls_forced=false for bluff_rounds.

4. ALTER TABLE sketch_rounds FORCE ROW LEVEL SECURITY — MISSING. pg_class shows rls_forced=false for sketch_rounds.

Migration history table has no row matching 062 or party_secret_column_revoke. The file itself carries the comment "NOT YET APPLIED". The REVOKE artifacts are de facto inert (no SELECT was ever granted at table level to those roles), but the FORCE RLS artifact is definitively absent on both tables.

### LOW — `lib/migrations/20260628120000_techhub_leaderboard.sql` (not_applied)

**Missing:**
- table: public.techhub_leaderboard (with columns id, user_id, mode, period_key, best_score, best_grade, updated_at, created_at)
- constraint: unique (user_id, mode, period_key)
- constraint: check (mode in ('combo','chaos','weekly'))
- constraint: check (best_score between 0 and 100)
- constraint: check (best_grade in ('S','A','B','C','D'))
- RLS enabled on techhub_leaderboard
- policy: techhub_leaderboard_owner_read
- index: idx_techhub_leaderboard_period (mode, period_key, best_score desc)
- index: idx_techhub_leaderboard_user (user_id)

**Code dependency:** app/api/techhub/leaderboard/route.ts — both GET and POST handlers query `techhub_leaderboard` via supabaseAdmin. However, both handlers include an explicit `tableMissing()` guard that catches Postgres error code `42P01` ("relation does not exist") and returns `{ liveYet: false }` with a 200 status rather than a 500. The Board UI is designed to show a "goes live soon" preview when `liveYet` is false. No hot-path corruption or 500 occurs while the migration is held; the feature self-disables cleanly.

**Evidence:** Table `public.techhub_leaderboard` is absent from `information_schema.tables`. No rows returned for its indexes (`idx_techhub_leaderboard_period`, `idx_techhub_leaderboard_user`) in `pg_indexes`, no policy row (`techhub_leaderboard_owner_read`) in `pg_policies`, and no matching row in `supabase_migrations.schema_migrations` for the `20260628` timestamp. The migration header itself reads "HELD MIGRATION: do NOT apply until Sam gives the go." — this is intentionally withheld, not lost.

### LOW — `lib/migrations/20260701120000_weak_spot_review_sr.sql` (partial)

**Missing:**
- COMMENT ON COLUMN ninny_wrong_answers.review_streak (comment body absent from pg_description)
- COMMENT ON COLUMN ninny_wrong_answers.review_interval_days (comment body absent from pg_description)
- supabase_migrations.schema_migrations history row for 20260701120000

**Code dependency:** The columns and index are the load-bearing artifacts. Live code in /Users/samc/Desktop/lionade/app/api/ninny/review/grade/route.ts reads/writes review_streak and review_interval_days on every grading call (SELECT + UPDATE hot path). /Users/samc/Desktop/lionade/lib/weak-spot-review.ts and /Users/samc/Desktop/lionade/lib/review-hub.ts also reference both columns. Since these columns ARE present in the live DB the feature is not broken. The missing COMMENTs and history row are metadata-only gaps.

**Evidence:** All structural artifacts are live: both columns exist (review_streak INTEGER NOT NULL DEFAULT 0, review_interval_days INTEGER NULL) and the index idx_ninny_wrong_answers_review ON (user_id, last_seen_at) is present. However, the two COMMENT ON COLUMN statements did not apply — pg_description returns NULL for both columns. No row exists in supabase_migrations.schema_migrations matching this file's timestamp or name, confirming the DDL was applied outside the tracked migration path (likely via SQL editor), and the COMMENTs were skipped or never run. The migration header explicitly marks this file as "HELD: apply manually," which is consistent with that pattern.

### LOW — `supabase/migrations/20260603164500_demo_account.sql` (partial)

**Missing:**
- user_inventory seed row for name_fx_rainbow (equipped=true) — silently failed because item_id column is UUID but migration passed a text slug; exception handler swallowed the error

**Code dependency:** app/shop/page.tsx and components/CosmeticLocker.tsx reference name_fx_rainbow as a string key for rendering the rainbow username effect in the shop UI. The equip state is read from user_inventory via app/api/me/equip/route.ts and app/api/me/loadout/route.ts. Since no inventory row exists for the demo user, the demo account cannot display the rainbow name effect that the migration intended to showcase cosmetics to testers. This is a cosmetic demo-experience gap, not a data-corruption path — the demo account works for all other features.

**Evidence:** Migration history: recorded as "demo_account" in supabase_migrations.schema_migrations. auth.users demo row: present (id=d3500000-0000-0000-0000-000000000000, email=demo@getlionade.com, email_confirmed_at not null). profiles demo row: present (username=demo, onboarding_completed=true; coins=110 at probe time, seeded at 5000 but drained by usage). vocab_banks: both Spanish Starter (d3500000-0000-0000-0000-000000000001) and AWS Basics (d3500000-0000-0000-0000-000000000002) present. vocab_words: 5 rows present for demo user (hola->hello confirmed). class_notes: 2 rows present, "Welcome to Lionade" (d3500000-0000-0000-0000-000000000003) confirmed. RLS policy profiles_block_demo_self_update: present, RESTRICTIVE, UPDATE. MISSING: user_inventory name_fx_rainbow seed — the live user_inventory.item_id column is type UUID, but the migration inserts the text slug 'name_fx_rainbow'; the DO block exception handler swallowed the error silently (0 inventory rows for the demo user). The shop catalog uses name_fx_rainbow as a string key in TypeScript, never as a UUID insert, so the schema mismatch is real.

### LOW — `supabase/migrations/20260604000000_session_lifecycle.sql` (partial)

**Missing:**
- daily_drill_progress_insert RLS policy (FOR INSERT WITH CHECK auth.uid() = user_id)
- daily_drill_progress_update RLS policy (FOR UPDATE USING auth.uid() = user_id)
- daily_drill_progress_delete RLS policy (FOR DELETE USING auth.uid() = user_id)
- REVOKE UPDATE (active_session) ON profiles FROM authenticated, anon — both roles still have column-level UPDATE privilege

**Code dependency:** daily_drill_progress writes in /Users/samc/Desktop/lionade/app/api/daily-drill/state/route.ts use supabaseAdmin (service role) exclusively — missing user-JWT RLS policies do not affect this hot path. active_session writes all route through SECURITY DEFINER RPCs (/Users/samc/Desktop/lionade/lib/presence.ts, /Users/samc/Desktop/lionade/lib/active-session.ts only reads the column) — the failed REVOKE is a hardening gap only, not a functional break.

**Evidence:** Migration history row 20260604000000 is present. All tables (presence_heartbeats, party_round_votes, mastery_session_state, daily_drill_progress, quiz_session_state), columns (profiles.active_session jsonb; sketch_rounds.phase/winner_user_id/celebrating_started_at), all 9 indexes, and all 4 RPCs (ping_presence, reap_afk_presence, set_active_session, clear_active_session) are verified present in the live schema. Two artifacts are missing/ineffective: (1) daily_drill_progress RLS policies insert/update/delete are absent (only the select policy exists); (2) REVOKE UPDATE (active_session) ON profiles FROM authenticated, anon did not take effect — has_column_privilege returns true for both authenticated and anon roles on that column.


## Fully applied (118)

002_add_gamification_columns, 003_fix_quiz_sessions_fk, 005_bounties_and_bets, 006_username_changes, 007_user_preferences, 009_avatar_fields, 011_last_activity_timestamp, 012_fix_existing_users_onboarding, 015_ninny_tables, 016_relax_constraints, 017_ninny_chat_refactor, 018_ninny_unlocked_modes, 020_progressive_levels, 021_fix_new_user_trigger, 022_fix_signup_trigger, 023_question_bank, 024_bounty_rotation, 026_login_attempts, 027_nudges, 028_mastery_user_exams, 029_mastery_content_cache, 030_mastery_progress, 031_mastery_sessions, 032_profile_plan, 033_class_notebook, 035_daily_drill, 036_academia_onboarding, 037_streak_revive, 039_performance_indexes, 040_fix_user_id_fks, 042_class_features, 043_revert_avatar_system, 044_class_syllabi_storage_policy, 047_subject_stats_rpc, 048_welcome_email_tracking, 049_arena_v2_ghosts, 050_arena_v2_ghost_elo, 051_lionade_party, 052_party_ready_state, 053_party_player_topics, 054_competitive_modes, 055_competitive_party_rls_hardening, 056_party_pokerface, 057_admin_console, 058_competitive_void_forfeit, 059_competitive_starts_at, 060_settings_overhaul, 061_party_trivia, 063_equipped_cosmetic_slots, 064_secret_and_equipped_hardening, 065_plan_grants, 066_game_rewards, 067_quiz_attempt_idempotency, 068_stripe_event_claim, 069_daily_claim_atomicity, 070_fang_iap_idempotency, 071_leaderboard_perf, 072_spend_refund_source, 073_flagged_content, 074_streak_reminder_sent_at, 075_reconcile_dual_ledger, 076_lockdown_definer_functions, 077_milestone_awards_idempotency, 078_guard_profiles_privileged_columns, 079_lock_server_managed_table_writes, 080_guard_profiles_xp_streak, 081_lock_question_bank_read, 082_cosmetic_loadouts, 20260416000001_fix_signup_trigger, 20260526213500_arena_v2_ghosts, 20260526220000_arena_v2_ghost_elo, 20260526230000_lionade_party, 20260527000000_party_ready_state, 20260527003000_party_player_topics, 20260528000000_competitive_modes, 20260528010000_competitive_party_rls_hardening, 20260528020000_party_pokerface, 20260529000000_party_sketch_fang_rewards, 20260529010000_sketch_candidate_words, 20260531223724_atomic_coins_rpc, 20260603013600_dual_ledger_fangs, 20260603090250_vocab_words, 20260603100000_vocab_backend_support, 20260603143154_word_banks, 20260603152723_public_banks, 20260603154104_shop_v2_identity, 20260604120000_resume_coach, 20260604180000_pardy_tile_claims, 20260604200000_equipped_username_effect, 20260605000000_vocab_self_confidence, 20260605142539_trust_gaps_visibility_prefs, 20260605200000_party_last_game, 20260605220000_ai_call_log, 20260605230000_bluff_answers_truth_fake_coexist, 20260607_party_v2, 20260610_class_assignments, 20260610_party_word_difficulty, 20260610_sketch_bank_source, 20260611_note_images_storage, 20260616121503_team_management, 20260616130000_shared_credentials, 20260616140000_security_monitoring, 20260616150000_feature_flags, 20260616160000_feature_flags_v2, 20260616170000_status_incidents_health, 20260617120000_fk_perf_indexes, 20260618120000_mastery_server_backlog, 20260618130000_coin_tx_types_and_competitive_settle, 20260618140000_mastery_hints, 20260618150000_grant_earned_cosmetic, 20260620150000_vocab_words_nullable_lang, 20260702090000_web_features_ledger_types, 20260702100000_review_hub_sm2, 20260702110000_focus_rooms, 20260702120000_streak_pacts, 20260702130000_study_sets, 20260702140000_library_addendum, add_onboarding_columns


*Generated by the prod-schema-drift-audit workflow (137 read-only agents), session 2026-07-03.*
