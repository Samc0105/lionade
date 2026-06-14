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

    // Read tier (for the multiplier) + xp. Balance is no longer read here —
    // the credit goes through the atomic update_user_coins RPC, which reads and
    // writes coins itself and keeps the dual ledger (fangs_cashable) in sync.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("xp, plan, subscription_status")
      .eq("id", userId)
      .single();

    // Multiplier resolved off the same profile read — no extra round-trip.
    const boostedCoinReward = profile
      ? applyFangMultiplierFromTier(mission.coinReward, profile.plan as string | null, profile.subscription_status as string | null)
      : mission.coinReward;

    // Atomic credit (no lost-update race with concurrent quiz/bet grants).
    if (boostedCoinReward > 0) {
      const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: boostedCoinReward,
        p_min_balance: 0,
        p_source: "cashable",
      });
      if (creditErr) {
        // Release the claim so a retry can pay — the reward was never granted.
        await supabaseAdmin
          .from("user_daily_missions")
          .update({ claimed: false, claimed_at: null })
          .eq("user_id", userId)
          .eq("mission_date", todayDate)
          .eq("mission_id", missionId);
        console.error("[missions/claim] credit:", creditErr.message);
        return NextResponse.json({ error: "Claim failed" }, { status: 500 });
      }
    }

    // XP is not dual-ledger, so it stays a plain read-modify-write.
    if (profile && mission.xpReward > 0) {
      await supabaseAdmin
        .from("profiles")
        .update({ xp: (profile.xp ?? 0) + mission.xpReward })
        .eq("id", userId);
    }

    // Log coin transaction (the RPC updates balance only, not the ledger).
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
