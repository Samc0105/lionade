import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { userId, coinsStaked, targetScore } = await req.json();
    if (!userId || !coinsStaked || !targetScore) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Validate target score
    if (![7, 8, 9, 10].includes(targetScore)) {
      return NextResponse.json({ error: "Invalid target score" }, { status: 400 });
    }

    // Check no active bet
    const { data: existing } = await supabaseAdmin
      .from("daily_bets")
      .select("id")
      .eq("user_id", userId)
      .is("resolved_at", null)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "You already have an active bet" }, { status: 400 });
    }

    // Check user has enough coins
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();

    if (!profile || profile.coins < coinsStaked) {
      return NextResponse.json({ error: "Not enough coins" }, { status: 400 });
    }

    // Deduct coins
    await supabaseAdmin
      .from("profiles")
      .update({ coins: profile.coins - coinsStaked })
      .eq("id", userId);

    // Create bet
    const { data: bet, error: betErr } = await supabaseAdmin
      .from("daily_bets")
      .insert({
        user_id: userId,
        coins_staked: coinsStaked,
        target_score: targetScore,
        target_total: 10,
      })
      .select("id, coins_staked, target_score, target_total, subject, won, coins_won, resolved_at")
      .single();

    if (betErr) {
      // Refund coins on error
      await supabaseAdmin
        .from("profiles")
        .update({ coins: profile.coins })
        .eq("id", userId);
      return NextResponse.json({ error: betErr.message }, { status: 500 });
    }

    // Log coin deduction
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: -coinsStaked,
      type: "bet_placed",
      reference_id: bet.id,
      description: `Bet: ${coinsStaked} coins on ${targetScore}/10`,
    });

    return NextResponse.json({ success: true, bet });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
