import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { applyFangMultiplier } from "@/lib/mastery-plan";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { bountyId } = await req.json();
    if (!bountyId) {
      return NextResponse.json({ error: "Missing bountyId" }, { status: 400 });
    }

    // Atomic claim: only flip claimed=true if it's currently false AND completed=true.
    // This single conditional update closes the double-claim race window.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("user_bounties")
      .update({ claimed: true })
      .eq("user_id", userId)
      .eq("bounty_id", bountyId)
      .eq("completed", true)
      .eq("claimed", false)
      .select("id")
      .maybeSingle();

    if (claimErr) {
      console.error("[claim-bounty] update:", claimErr.message);
      return NextResponse.json({ error: "Claim failed" }, { status: 500 });
    }
    if (!claimed) {
      return NextResponse.json({ error: "Bounty not claimable (incomplete or already claimed)" }, { status: 400 });
    }

    // Fetch bounty rewards
    const { data: bounty } = await supabaseAdmin
      .from("bounties")
      .select("coin_reward, xp_reward, title")
      .eq("id", bountyId)
      .single();

    if (!bounty) {
      return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
    }

    // Award coins atomically — claim already locked above, but a separate
    // read-modify-write on coins would still race with concurrent quiz reward
    // grants. xp is a separate UPDATE (no atomic RPC yet — lower risk surface).
    const boostedCoinReward = await applyFangMultiplier(bounty.coin_reward, userId, supabaseAdmin);
    if (boostedCoinReward > 0) {
      const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: boostedCoinReward,
        p_min_balance: 0,
        p_source: "cashable",
      });
      if (creditErr) {
        console.error("[claim-bounty] credit:", creditErr.message);
      }
    }

    if (bounty.xp_reward > 0) {
      const { data: xpProfile } = await supabaseAdmin
        .from("profiles")
        .select("xp")
        .eq("id", userId)
        .single();
      if (xpProfile) {
        const { error: xpErr } = await supabaseAdmin
          .from("profiles")
          .update({ xp: (xpProfile.xp ?? 0) + bounty.xp_reward })
          .eq("id", userId);
        if (xpErr) console.error("[claim-bounty] xp update:", xpErr.message);
      }
    }

    // Log coin transaction
    if (boostedCoinReward > 0) {
      await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: boostedCoinReward,
        type: "bounty_reward",
        reference_id: bountyId,
        description: `Bounty: ${bounty.title}`,
      });
    }

    return NextResponse.json({ success: true, coinsAwarded: boostedCoinReward, xpAwarded: bounty.xp_reward });
  } catch (err) {
    console.error("[claim-bounty]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
