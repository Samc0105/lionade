import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Escalating daily login bonus: Day 1 = 10F, Day 2 = 15F, Day 3+ = 25F.
// Resets to Day 1 if user misses a day.
const BONUS_TIERS = [10, 15, 25]; // index 0 = first day, 1 = second, 2+ = third+

// POST /api/login-bonus
// Awards a small Fang bonus on the user's first visit each calendar day (UTC).
// Returns { awarded: true, amount: N, consecutiveDays: N } or { awarded: false }
// if already claimed today.
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const todayUTC = new Date().toISOString().split("T")[0];

  // Check if already awarded today — idempotent
  const { count: alreadyToday } = await supabaseAdmin
    .from("coin_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "login_bonus")
    .gte("created_at", `${todayUTC}T00:00:00.000Z`);

  if ((alreadyToday ?? 0) > 0) {
    return NextResponse.json({ awarded: false, reason: "already_claimed" });
  }

  // Count consecutive days of login bonuses (including today if we award it)
  // by checking yesterday
  const yesterdayUTC = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const { count: yesterdayBonus } = await supabaseAdmin
    .from("coin_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "login_bonus")
    .gte("created_at", `${yesterdayUTC}T00:00:00.000Z`)
    .lt("created_at", `${todayUTC}T00:00:00.000Z`);

  // If they had a bonus yesterday, they're on a consecutive streak
  // We don't need to track the full streak length — just 3 tiers
  let tierIndex: number;
  if ((yesterdayBonus ?? 0) > 0) {
    // Check two days ago too for tier 2+
    const twoDaysAgoUTC = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
    const { count: twoDaysAgoBonus } = await supabaseAdmin
      .from("coin_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("type", "login_bonus")
      .gte("created_at", `${twoDaysAgoUTC}T00:00:00.000Z`)
      .lt("created_at", `${yesterdayUTC}T00:00:00.000Z`);

    tierIndex = (twoDaysAgoBonus ?? 0) > 0 ? 2 : 1;
  } else {
    tierIndex = 0; // First day (or streak broken)
  }

  const amount = BONUS_TIERS[Math.min(tierIndex, BONUS_TIERS.length - 1)];

  // Award the bonus
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  await supabaseAdmin
    .from("profiles")
    .update({ coins: (profile.coins ?? 0) + amount })
    .eq("id", userId);

  await supabaseAdmin.from("coin_transactions").insert({
    user_id: userId,
    amount,
    type: "login_bonus",
    description: `Day ${tierIndex + 1} login bonus`,
  });

  return NextResponse.json({
    awarded: true,
    amount,
    consecutiveDays: tierIndex + 1,
  });
}
