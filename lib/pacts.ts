/**
 * Streak Pacts — duo accountability streaks (server-side core).
 *
 * SERVER-ONLY: imports supabaseAdmin. Route files under app/api/pacts/* stay
 * thin HTTP handlers; all shared logic lives here (house rule: route files may
 * only export handlers + the Next config whitelist).
 *
 * Data model (lib/migrations/20260702120000_streak_pacts.sql, HELD):
 *   streak_pacts(user_a < user_b UNIQUE, status pending/active/ended,
 *   current_streak, best_streak, last_both_day, last_nudge_day,
 *   milestone_7_granted, milestone_30_granted, invited_by, created_at)
 *
 * The joint streak convention mirrors the rest of the app's UTC-day model
 * (daily_activity has one row per user per UTC day):
 *   - a day COUNTS when BOTH members have a daily_activity row that day
 *   - consecutive both-days increment the joint streak
 *   - a fully-elapsed day where either member was inactive resets it to 0
 *   - "today" never counts as a gap while it is still in progress
 *
 * Reconciliation is LAZY + DETERMINISTIC: GET /api/pacts replays history
 * forward from the last_both_day cursor, so concurrent reconciles compute the
 * same values and the write is idempotent. The accept route seeds
 * last_both_day = (accept day - 1) so pre-pact history never counts.
 *
 * Milestones: crossing 7 / 30 both-days grants BOTH members +50 / +250 Fangs
 * (server-authoritative: update_user_coins cashable + a coin_transactions row
 * of type 'pact_milestone'). The ledger type comes from the HELD migration
 * 20260702090000_web_features_ledger_types.sql; until Sam applies it the
 * ledger insert fails with 23514 and the grant FAIL-SOFTS: booleans stay
 * false, no coins move, and the API flags milestonePending for honest UI copy.
 * The ledger row is inserted BEFORE the RPC credit on purpose: in the expected
 * held state we bounce off the CHECK constraint before any money moves.
 */

import { supabaseAdmin } from "@/lib/supabase-server";
import { isMissingSchema } from "@/lib/db/missing-schema";
import { PACT_MILESTONES } from "@/lib/pacts-shared";

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_ACTIVE_PACTS = 3;
// Milestone table lives in lib/pacts-shared.ts (client-safe) so the dashboard
// cards render the same numbers this module pays. Re-exported for existing
// server-side importers.
export { PACT_MILESTONES };
/** How far back reconcile will look. An idle pact resets to 0 anyway, so the
 *  only loss from this floor is undercounting a 400+ day unbroken duo streak. */
export const RECONCILE_LOOKBACK_DAYS = 400;

// Missing-schema detection ("the HELD migration isn't applied yet") is the
// shared predicate in lib/db/missing-schema.ts. Re-exported for the routes.
export { isMissingSchema };

// ── UTC date helpers (YYYY-MM-DD strings, same convention as daily_activity) ─

export function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

export function addDaysUtc(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().split("T")[0];
}

/** Canonical (user_a, user_b) ordering for the pair-unique row. */
export function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

// ── Row shape ────────────────────────────────────────────────────────────────

export interface PactRow {
  id: string;
  user_a: string;
  user_b: string;
  invited_by: string;
  status: "pending" | "active" | "ended";
  current_streak: number;
  best_streak: number;
  last_both_day: string | null;
  last_nudge_day: string | null;
  milestone_7_granted: boolean;
  milestone_30_granted: boolean;
  created_at: string;
}

export const PACT_COLUMNS =
  "id, user_a, user_b, invited_by, status, current_streak, best_streak, last_both_day, last_nudge_day, milestone_7_granted, milestone_30_granted, created_at";

// ── Pure reconcile (deterministic, idempotent) ──────────────────────────────

export interface ReconcileResult {
  currentStreak: number;
  bestStreak: number;
  /** New cursor (latest both-day processed); unchanged if none. */
  lastBothDay: string | null;
  changed: boolean;
}

/**
 * Replay both members' activity-day sets forward from the stored cursor.
 *
 *  - Both-days strictly AFTER last_both_day are processed in ascending order.
 *  - A both-day exactly one day after the cursor extends the streak; any hole
 *    resets the run to 1 (that both-day itself counts).
 *  - Trailing gap: if the latest both-day is before yesterday, at least one
 *    full UTC day elapsed with a miss, so the current streak is 0. Today in
 *    progress is never a gap.
 *
 * Pure function: no I/O, safe to call from any number of concurrent requests.
 */
export function reconcileStreak(
  prev: Pick<PactRow, "current_streak" | "best_streak" | "last_both_day">,
  daysA: ReadonlySet<string>,
  daysB: ReadonlySet<string>,
  today: string = todayUtc(),
): ReconcileResult {
  const cursor0 = prev.last_both_day;
  const bothDays = Array.from(daysA)
    .filter((d) => daysB.has(d) && d <= today && (!cursor0 || d > cursor0))
    .sort();

  let streak = prev.current_streak;
  let best = prev.best_streak;
  let cursor = cursor0;

  for (const d of bothDays) {
    if (cursor && d === addDaysUtc(cursor, 1)) streak += 1;
    else streak = 1; // fresh start (or restart after a hole)
    if (streak > best) best = streak;
    cursor = d;
  }

  // Trailing gap check — only fully-elapsed days can break the run.
  if (cursor && cursor < addDaysUtc(today, -1)) streak = 0;
  if (!cursor) streak = 0;

  return {
    currentStreak: streak,
    bestStreak: best,
    lastBothDay: cursor,
    changed:
      streak !== prev.current_streak ||
      best !== prev.best_streak ||
      cursor !== prev.last_both_day,
  };
}

// ── Activity fetch (per pact, bounded) ───────────────────────────────────────

/**
 * Fetch each member's activity-day sets since the pact's cursor (bounded by
 * RECONCILE_LOOKBACK_DAYS so the row count stays far under PostgREST caps:
 * 2 users x 400 days max). Uses gte (not gt) so today's rows are always
 * present for the studied-today flags even when the cursor is already today;
 * reconcileStreak re-filters to strictly-after-cursor itself.
 */
export async function fetchPactActivity(
  pact: Pick<PactRow, "user_a" | "user_b" | "last_both_day" | "created_at">,
  today: string = todayUtc(),
): Promise<{ daysA: Set<string>; daysB: Set<string> } | null> {
  const createdDay = pact.created_at.split("T")[0];
  const floor = addDaysUtc(today, -RECONCILE_LOOKBACK_DAYS);
  const since = [pact.last_both_day ?? createdDay, floor]
    .sort()
    .pop() as string; // max(cursor-or-createdDay, lookback floor)

  const { data, error } = await supabaseAdmin
    .from("daily_activity")
    .select("user_id, date")
    .in("user_id", [pact.user_a, pact.user_b])
    .gte("date", since)
    .lte("date", today);

  if (error) {
    console.error("[pacts] fetchPactActivity:", error.message);
    return null;
  }

  const daysA = new Set<string>();
  const daysB = new Set<string>();
  for (const row of data ?? []) {
    if (row.user_id === pact.user_a) daysA.add(row.date as string);
    else if (row.user_id === pact.user_b) daysB.add(row.date as string);
  }
  return { daysA, daysB };
}

// ── Milestone grant (CAS boolean + dual-ledger, fail-soft on 23514) ──────────

export type MilestoneGrantResult = "granted" | "pending" | "skipped";

/**
 * Grant one milestone (+amount Fangs to BOTH members).
 *
 * 1. Compare-and-swap the milestone boolean (id + boolean=false) so exactly
 *    one concurrent reconcile owns the grant.
 * 2. Insert BOTH ledger rows first. 23514 here means the ledger-type widening
 *    migration is unapplied: delete anything inserted, revert the CAS, return
 *    "pending" (no coins moved, retried on a later reconcile).
 * 3. Credit both members via the atomic money RPC. On a credit failure,
 *    compensate (reverse any completed credit, delete ledger rows, revert the
 *    CAS) so nobody keeps an unmatched grant. If a reversal itself fails the
 *    boolean is left TRUE and a MANUAL RECONCILE line is logged: never risk
 *    double-paying on retry.
 */
export async function grantPactMilestone(
  pactId: string,
  members: [string, string],
  milestone: 7 | 30,
): Promise<MilestoneGrantResult> {
  const col = milestone === 7 ? "milestone_7_granted" : "milestone_30_granted";
  const amount = PACT_MILESTONES[milestone];

  // 1) Claim the milestone.
  const { data: claimed, error: casErr } = await supabaseAdmin
    .from("streak_pacts")
    .update({ [col]: true })
    .eq("id", pactId)
    .eq(col, false)
    .select("id");
  if (casErr) {
    console.error("[pacts] milestone CAS:", casErr.message);
    return "skipped";
  }
  if (!claimed || claimed.length === 0) return "skipped"; // concurrent grant won

  const revertCas = async () => {
    const { error } = await supabaseAdmin
      .from("streak_pacts")
      .update({ [col]: false })
      .eq("id", pactId);
    if (error) console.error("[pacts] milestone CAS revert:", error.message);
  };

  // 2) Ledger rows first — the expected held-migration failure (23514) happens
  //    here, before any money moves.
  const ledger: { userId: string; rowId: string }[] = [];
  for (const userId of members) {
    const { data: row, error: ledErr } = await supabaseAdmin
      .from("coin_transactions")
      .insert({
        user_id: userId,
        amount,
        type: "pact_milestone",
        description: `Streak Pact milestone: ${milestone} days strong together`,
        reference_id: pactId,
      })
      .select("id")
      .single();
    if (ledErr || !row) {
      for (const l of ledger) {
        await supabaseAdmin.from("coin_transactions").delete().eq("id", l.rowId);
      }
      await revertCas();
      if (ledErr?.code === "23514") return "pending"; // type allowlist not widened yet
      console.error("[pacts] milestone ledger:", ledErr?.message ?? "no row");
      return "skipped";
    }
    ledger.push({ userId, rowId: row.id as string });
  }

  // 3) Credits.
  const credited: string[] = [];
  for (const userId of members) {
    const { error: rpcErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: amount,
      p_min_balance: 0,
      p_source: "cashable",
    });
    if (!rpcErr) {
      credited.push(userId);
      continue;
    }
    console.error("[pacts] milestone credit:", rpcErr.message);

    // Compensate whoever already got the credit.
    for (const cUser of credited) {
      const { error: backErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: cUser,
        p_delta: -amount,
        p_min_balance: 0,
        p_source: "cashable",
      });
      if (backErr) {
        // Reversal failed (e.g. they spent it in the same instant). Keep the
        // boolean TRUE so a retry cannot double-pay; leave their ledger row so
        // the books still match their balance; flag for a human.
        console.error(
          `[pacts] MANUAL RECONCILE NEEDED: pact ${pactId} milestone ${milestone} half-granted; ` +
            `user ${cUser} kept ${amount} Fangs; reversal failed: ${backErr.message}`,
        );
        for (const l of ledger) {
          if (l.userId !== cUser) {
            await supabaseAdmin.from("coin_transactions").delete().eq("id", l.rowId);
          }
        }
        return "skipped";
      }
    }
    for (const l of ledger) {
      await supabaseAdmin.from("coin_transactions").delete().eq("id", l.rowId);
    }
    await revertCas();
    return "skipped";
  }

  return "granted";
}

// ── Shared route helpers ─────────────────────────────────────────────────────

/** Count a user's ACTIVE pacts (the 3-pact cap; enforced at invite + accept). */
export async function countActivePacts(userId: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("streak_pacts")
    .select("id", { count: "exact", head: true })
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq("status", "active");
  if (error) {
    if (isMissingSchema(error)) return null;
    console.error("[pacts] countActivePacts:", error.message);
    return null;
  }
  return count ?? 0;
}

/** Load one pact the caller is a member of (any status filter applied by caller). */
export async function loadMemberPact(
  pactId: string,
  userId: string,
): Promise<PactRow | null | "missing-schema"> {
  const { data, error } = await supabaseAdmin
    .from("streak_pacts")
    .select(PACT_COLUMNS)
    .eq("id", pactId)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return "missing-schema";
    console.error("[pacts] loadMemberPact:", error.message);
    return null;
  }
  return (data as PactRow) ?? null;
}
