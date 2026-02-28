import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { userId, bountyId } = await req.json();
    if (!userId || !bountyId) {
      return NextResponse.json({ error: "Missing userId or bountyId" }, { status: 400 });
    }

    // Fetch user_bounty
    const { data: ub, error: ubErr } = await supabaseAdmin
      .from("user_bounties")
      .select("id, completed, claimed")
      .eq("user_id", userId)
      .eq("bounty_id", bountyId)
      .single();

    if (ubErr || !ub) {
      return NextResponse.json({ error: "Bounty progress not found" }, { status: 404 });
    }
    if (!ub.completed) {
      return NextResponse.json({ error: "Bounty not completed yet" }, { status: 400 });
    }
    if (ub.claimed) {
      return NextResponse.json({ error: "Already claimed" }, { status: 400 });
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

    // Mark as claimed
    await supabaseAdmin
      .from("user_bounties")
      .update({ claimed: true })
      .eq("id", ub.id);

    // Award coins + xp
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
