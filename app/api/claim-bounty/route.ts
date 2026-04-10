import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

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

    // Award coins + xp (claim already locked above)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp")
      .eq("id", userId)
      .single();

    if (profile) {
      await supabaseAdmin
        .from("profiles")
        .update({
          coins: (profile.coins ?? 0) + bounty.coin_reward,
          xp: (profile.xp ?? 0) + bounty.xp_reward,
        })
        .eq("id", userId);
    }

    // Log coin transaction
    if (bounty.coin_reward > 0) {
      await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: bounty.coin_reward,
        type: "bounty_reward",
        reference_id: bountyId,
        description: `Bounty: ${bounty.title}`,
      });
    }

    return NextResponse.json({ success: true, coinsAwarded: bounty.coin_reward, xpAwarded: bounty.xp_reward });
  } catch (err) {
    console.error("[claim-bounty]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
