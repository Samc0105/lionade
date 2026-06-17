-- 20260617120000_fk_perf_indexes.sql
-- ============================================================
-- WEB perf migration: missing foreign-key + hot-query-path indexes.
-- RUN MANUALLY (Sam) via the Supabase SQL editor. No app code applies this.
-- Sorts AFTER 20260616170000_status_incidents_health.sql.
--
-- Fully idempotent: every statement uses CREATE INDEX IF NOT EXISTS, so this
-- is safe to re-run and harmless if an equivalent index already exists.
--
-- NOTE ON CONCURRENCY: these are PLAIN CREATE INDEX (NOT CONCURRENTLY). The
-- Supabase SQL editor runs each statement inside an implicit transaction, and
-- CREATE INDEX CONCURRENTLY cannot run in a transaction block. Each index here
-- is on a table small enough that the brief ACCESS EXCLUSIVE lock during build
-- is acceptable for a manual, off-peak run. Do NOT add CONCURRENTLY here.
--
-- ── WHY each index ──────────────────────────────────────────────────────────
-- This sweep audited every foreign key declared in migrations 002-081 + the
-- 2026 timestamped migrations against the existing index inventory, then
-- confirmed each gap against a real query path in app/ and lib/. Only indexes
-- that are BOTH (a) clearly missing and (b) clearly exercised by a real query
-- or by a delete-cascade scan are included. Over-indexing is avoided: FK
-- columns that are only ever SELECTed (never filtered/joined/cascaded against)
-- and FK columns on tiny admin-only tables are deliberately left out.
-- ============================================================

-- ════════════════════════════════════════════════════════════════════════
-- 1. user_bounties(bounty_id) — unindexed FK + hot rotation delete
-- ════════════════════════════════════════════════════════════════════════
-- Existing on this table: idx_user_bounties_user (user_id), UNIQUE(user_id, bounty_id).
--
-- The bounty rotation job (lib/bounty-rotation.ts) runs on every daily/weekly
-- rotation and issues:
--     DELETE FROM user_bounties WHERE bounty_id IN (...) AND claimed = false
-- This filters by bounty_id ONLY (no user_id), so neither idx_user_bounties_user
-- nor the leading-column-user_id UNIQUE index helps; today it sequentially scans
-- the entire user_bounties table, which grows as users x active-bounties.
-- This index also covers the FK-validation scan Postgres runs when a row in
-- the parent `bounties` table is deleted (ON DELETE CASCADE to user_bounties).
CREATE INDEX IF NOT EXISTS idx_user_bounties_bounty
  ON user_bounties(bounty_id)
  WHERE claimed = false;

-- ════════════════════════════════════════════════════════════════════════
-- 2. notifications(related_user_id) — unindexed ON DELETE SET NULL FK
-- ════════════════════════════════════════════════════════════════════════
-- Existing on this table: idx_notifications_user (user_id, created_at DESC),
-- idx_notifications_unread (user_id, read) WHERE read = false.
--
-- related_user_id is `REFERENCES profiles(id) ON DELETE SET NULL` (migration
-- 019) and has NO covering index. The account hard-delete reaper
-- (app/api/cron/reap-pending-deletions/route.ts) calls
-- supabase.auth.admin.deleteUser(id), which cascades through every FK to
-- profiles(id). For this SET NULL FK, Postgres must scan `notifications` to
-- null out related_user_id for the deleted user. `notifications` is one of the
-- fastest-growing tables (a row per nudge, friend request, party invite, and
-- arena challenge), so the per-delete seq-scan is a real cost. Partial on
-- "is not null" keeps the index small: most notifications carry no related user.
CREATE INDEX IF NOT EXISTS idx_notifications_related_user
  ON notifications(related_user_id)
  WHERE related_user_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 3. daily_activity(user_id, date) — hottest point-lookup write path
-- ════════════════════════════════════════════════════════════════════════
-- daily_activity.user_id is `REFERENCES profiles(id) ON DELETE CASCADE`
-- (repointed in migration 040). Every write path against this table filters by
-- the exact pair (user_id, date):
--     app/api/save-quiz-results/route.ts   (every quiz completion)
--     app/api/ninny/complete/route.ts      (every Ninny session)
--     lib/daily-activity-server.ts         (recordDailyActivity, select-then-insert)
--     lib/missions.ts                      (daily mission progress checks)
--     lib/db.ts                            (clock-in / daily streak tick)
-- These are select-then-insert (not upsert-on-conflict) paths, so the lookup
-- benefits from a composite (user_id, date) btree. This is one of the highest-
-- frequency queries in the app (it fires on the hottest write path) and a
-- seq-scan here taxes every quiz save once the table grows.
--
-- IDEMPOTENT + REDUNDANCY-SAFE: if the base schema already defined a
-- UNIQUE(user_id, date) constraint (which would auto-create a covering index),
-- this differently-named btree is simply redundant and tiny; IF NOT EXISTS only
-- guards the index NAME, so to keep this fully no-op when the unique index
-- already exists, the name below is distinct and the extra index is negligible.
CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date
  ON daily_activity(user_id, date);
