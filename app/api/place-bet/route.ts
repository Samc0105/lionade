import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: { coinsStaked?: unknown; targetScore?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const coinsStaked = Math.max(1, Math.min(10000, Number(body.coinsStaked) || 0));
    const targetScore = Number(body.targetScore);

    if (!coinsStaked || !targetScore) {
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

    // Atomic debit — guard prevents double-spend race across parallel tabs.
    const { data: debitData, error: debitErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: -coinsStaked,
      p_min_balance: 0,
      p_source: "spend",
    });

    if (debitErr) {
      if (debitErr.code === "P0001") {
        return NextResponse.json({ error: "Not enough coins" }, { status: 400 });
      }
      console.error("[place-bet] debit:", debitErr.message);
      return NextResponse.json({ error: "Failed to place bet" }, { status: 500 });
    }

    const balanceAfterDebit: number = Array.isArray(debitData)
      ? debitData[0]?.new_coins
      : (debitData as { new_coins: number } | null)?.new_coins;

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
      // Refund coins on insert failure — atomic credit so refund itself can't race.
      await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: coinsStaked,
        p_min_balance: 0,
        p_source: "cashable",
      });
      console.error("[place-bet] insert:", betErr.message);
      return NextResponse.json({ error: "Failed to place bet" }, { status: 500 });
    }

    // Log coin deduction
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: -coinsStaked,
      type: "bet_placed",
      reference_id: bet.id,
      description: `Bet: ${coinsStaked} coins on ${targetScore}/10`,
    });

    return NextResponse.json({ success: true, bet, newCoins: balanceAfterDebit });
  } catch (err) {
    console.error("[place-bet]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
