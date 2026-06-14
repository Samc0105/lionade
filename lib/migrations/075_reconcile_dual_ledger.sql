-- ============================================================
-- Migration 075: one-time reconciliation of the dual Fang ledger.
-- STATUS: APPLIED to production 2026-06-14 (after Sam's explicit go). Verified:
-- 8 drifted rows reconciled, 0 remaining, total coins unchanged (7572 == 7572).
-- Idempotent (re-running is a no-op once the invariant holds).
-- ============================================================
--
-- WHY: the dual ledger invariant is `coins = fangs_cashable + fangs_iap` (the
-- V2 cash-out gate reads the bucket columns, not `coins`). Historically many
-- earn/spend paths wrote `profiles.coins` with a raw read-modify-write that
-- never touched the buckets (now fixed in the part-1/part-2 RPC sweep), so the
-- buckets drifted: an audit found 8/17 profiles off, +643 Fangs of `coins`
-- untracked in any bucket, all from earn paths (every drifted row had iap=0 and
-- POSITIVE drift = coins exceeded the buckets).
--
-- FIX: attribute each row's untracked balance so the invariant holds again,
-- WITHOUT changing `coins` (the spendable balance the user actually sees stays
-- byte-identical — this only corrects the accounting split). We preserve as
-- much of the audited `fangs_iap` bucket as possible (it is only ever written
-- by the trustworthy Stripe IAP credit path) and put the remainder in
-- fangs_cashable:
--
--   new_iap      = least(old_iap, coins)        -- never more iap than total
--   new_cashable = coins - least(old_iap, coins) -- the rest
--
-- Both reference the OLD fangs_iap (single-statement UPDATE), both end >= 0, and
-- their sum is exactly `coins`. For the current drifted rows (all iap=0) this
-- simplifies to fangs_cashable = coins. lifetime_fangs_spent is NOT touched (it
-- is a separate spend-tracking column, not part of the balance invariant).
--
-- SAFE: pre-cash-out (V2 not launched), so no user can cash out today and there
-- is zero user-facing effect; this just makes the ledger correct for launch.
-- Guarded to coins >= 0 (defensive; no negative-coins rows exist).

update profiles
set
  fangs_iap      = least(coalesce(fangs_iap, 0), coins),
  fangs_cashable = coins - least(coalesce(fangs_iap, 0), coins)
where coins >= 0
  and coins is distinct from (coalesce(fangs_cashable, 0) + coalesce(fangs_iap, 0));
