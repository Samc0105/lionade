import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { getDailyMissions } from "@/lib/missions";
import { applyFangMultiplierFromTier } from "@/lib/mastery-plan";

export const dynamic = "force-dynamic";

// POST /api/missions/claim
// Claims a completed mission's reward (coins + XP).
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { missionId } = await req.json();
    if (!missionId) {
      return NextResponse.json({ error: "Missing missionId" }, { status: 400 });
    }

    // Verify this mission is actually one of today's missions
    const todayMissions = getDailyMissions();
    const mission = todayMissions.find(m => m.id === missionId);
    if (!mission) {
      return NextResponse.json({ error: "Invalid mission for today" }, { status: 400 });
    }

    const todayDate = new Date().toISOString().split("T")[0];

    // Atomic claim: only flip claimed=true if completed=true AND claimed=false
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("user_daily_missions")
      .update({ claimed: true, claimed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("mission_date", todayDate)
      .eq("mission_id", missionId)
      .eq("completed", true)
      .eq("claimed", false)
      .select("id")
      .maybeSingle();

    if (claimErr) {
      console.error("[missions/claim] update:", claimErr.message);
      return NextResponse.json({ error: "Claim failed" }, { status: 500 });
    }
    if (!claimed) {
      return NextResponse.json({ error: "Mission not claimable (incomplete or already claimed)" }, { status: 400 });
    }

    // Award coins + XP
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp, plan, subscription_status")
      .eq("id", userId)
      .single();

    // Multiplier resolved off the same profile read — no extra round-trip.
    const boostedCoinReward = profile
      ? applyFangMultiplierFromTier(mission.coinReward, profile.plan as string | null, profile.subscription_status as string | null)
      : mission.coinReward;

    if (profile) {
      await supabaseAdmin
        .from("profiles")
        .update({
          coins: (profile.coins ?? 0) + boostedCoinReward,
          xp: (profile.xp ?? 0) + mission.xpReward,
        })
        .eq("id", userId);
    }

    // Log coin transaction
    if (boostedCoinReward > 0) {
      await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: boostedCoinReward,
        type: "mission_reward",
        reference_id: missionId,
        description: `Mission: ${mission.title}`,
      });
    }

    return NextResponse.json({
      success: true,
      coinsAwarded: boostedCoinReward,
      xpAwarded: mission.xpReward,
    });
  } catch (err) {
    console.error("[missions/claim]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
