import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";

/**
 * GET /api/admin/health — Systems Health probe. Admin only.
 *
 * For each user-facing feature, probes the REAL read path: selects the exact
 * columns the app reads, limit 1. This catches the SCHEMA-DRIFT class that
 * silently broke shop purchases / cosmetics / mastery in prod this cycle
 * (code written against a table/column the live DB never had). A missing
 * table (42P01) or column (42703) shows RED here before a user ever taps in.
 *
 * Read-only: no RPC calls (they could mutate), no writes. Columns are the
 * drift risk; RPCs are stable. Safe to hit as often as you like.
 */

export const dynamic = "force-dynamic";

type Status = "ok" | "degraded" | "down";
interface Check {
  feature: string;
  category: string;
  status: Status;
  detail: string;
}

// One feature = one probe of the columns the app actually reads.
const PROBES: { feature: string; category: string; table: string; cols: string }[] = [
  { feature: "Fang ledger", category: "Economy", table: "coin_transactions", cols: "id, user_id, amount, type, reason" },
  { feature: "Balances (dual-ledger)", category: "Economy", table: "profiles", cols: "coins, fangs_cashable, fangs_iap" },
  { feature: "Shop purchases", category: "Shop", table: "user_inventory", cols: "item_id, item_type, purchased_at" },
  { feature: "Purchase history", category: "Shop", table: "purchase_history", cols: "item_id, quantity, total_cost, purchased_at" },
  { feature: "Shop catalog", category: "Shop", table: "shop_items", cols: "id, price, boost_type" },
  { feature: "Badges catalog", category: "Cosmetics", table: "badges", cols: "id, name, rarity" },
  { feature: "Earned badges", category: "Cosmetics", table: "user_badges", cols: "user_id, badge_id, earned_at" },
  { feature: "Earned cosmetics", category: "Cosmetics", table: "earned_cosmetics", cols: "user_id, cosmetic_id, earned_at, earned_via" },
  { feature: "Cosmetic loadouts", category: "Cosmetics", table: "cosmetic_loadouts", cols: "user_id, loadout_frame" },
  { feature: "Quiz Duel matches", category: "Compete", table: "arena_matches", cols: "id, player1_id, player2_id, status" },
  { feature: "Quiz Duel answers", category: "Compete", table: "arena_answers", cols: "match_id, is_correct, points_earned" },
  { feature: "Competitive matches", category: "Compete", table: "competitive_matches", cols: "id, team_a, team_b, starts_at" },
  { feature: "Competitive answers", category: "Compete", table: "competitive_responses", cols: "match_id, round_num, is_correct" },
  { feature: "TechHub shift grants", category: "Learn", table: "techhub_shift_completions", cols: "user_id, shift_id, granted_fangs" },
  { feature: "Resume Coach", category: "Learn", table: "resume_coach_sessions", cols: "id, user_id, analysis_json" },
  { feature: "Review Hub events", category: "Learn", table: "review_events", cols: "id, user_id, source, correct" },
  { feature: "AI call log", category: "AI", table: "ai_call_log", cols: "id, route, success, cost_micro_usd" },
];

async function probe(p: (typeof PROBES)[number]): Promise<Check> {
  const { feature, category, table, cols } = p;
  const { error } = await supabaseAdmin.from(table).select(cols).limit(1);
  if (!error) return { feature, category, status: "ok", detail: `${table} reads clean` };
  const code = (error as { code?: string }).code ?? "";
  if (code === "42P01")
    return { feature, category, status: "down", detail: `table "${table}" is missing (migration not applied)` };
  if (code === "42703")
    return { feature, category, status: "down", detail: `${table} is missing a column the app reads` };
  console.error("[admin/health] probe degraded:", feature, error.message);
  return { feature, category, status: "degraded", detail: "check failed" };
}

export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const checks = await Promise.all(PROBES.map(probe));
  const summary = {
    total: checks.length,
    ok: checks.filter((c) => c.status === "ok").length,
    degraded: checks.filter((c) => c.status === "degraded").length,
    down: checks.filter((c) => c.status === "down").length,
  };
  return NextResponse.json({ checks, summary });
}
