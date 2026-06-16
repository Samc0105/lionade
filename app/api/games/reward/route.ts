import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { assertFeatureLive } from "@/lib/feature-flags";
import { recordFeatureError } from "@/lib/feature-health";
import { applyFangMultiplierFromTier } from "@/lib/mastery-plan";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/reward — award Fangs for a score-game completion.
 *
 * Score games only: roardle / blitz / flashcards / timeline. Pardy is NOT here
 * — it credits per-tile through /api/games/pardy/submit with its own
 * (user_id, tile_id) idempotency. (The old `pardy_correct` entry was an
 * unprotected 200-Fang faucet and is removed.)
 *
 * Anti-faucet: each game pays AT MOST ONCE per UTC day per user, enforced by an
 * INSERT-first claim into game_rewards (PK user_id, game_type, reward_date). A
 * replay returns success with awarded: 0 + alreadyClaimed: true. The credit is
 * atomic via update_user_coins (p_source 'cashable'), never a raw read-modify-
 * write, so it can't lose updates or desync the dual ledger.
 */

// Per-game reward caps. Must match the actual game logic in app/games/page.tsx.
const MAX_REWARD_BY_GAME: Record<string, number> = {
  roardle: 50, // base 20 + bonus up to 18 ≈ 38, cap 50
  blitz: 60, // up to 30 correct × 2 = 60
  flashcards: 20, // 100% × 15 ≈ 15, cap 20
  timeline: 25, // 8 events × 3 = 24
};

const VALID_GAMES = Object.keys(MAX_REWARD_BY_GAME);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const m = await assertFeatureLive("games");
  if (m) return m;

  let body: { gameType?: unknown; amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const gameType = String(body.gameType ?? "");
    const amount = Number(body.amount ?? 0);

    if (!gameType || !amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!VALID_GAMES.includes(gameType)) {
      return NextResponse.json({ error: "Unknown game" }, { status: 400 });
    }
    // Server-side cap — client cannot grant arbitrary amounts.
    const cap = MAX_REWARD_BY_GAME[gameType];
    const safeAmount = Math.max(0, Math.min(cap, Math.floor(amount)));
    if (safeAmount === 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins, plan, subscription_status")
      .eq("id", userId)
      .single();

    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const boostedAmount = applyFangMultiplierFromTier(
      safeAmount,
      profile.plan as string | null,
      profile.subscription_status as string | null,
    );

    // ── 1. INSERT-first daily claim. One paid completion per game per UTC day.
    const rewardDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const { error: claimErr } = await supabaseAdmin.from("game_rewards").insert({
      user_id: userId,
      game_type: gameType,
      reward_date: rewardDate,
      awarded_fangs: boostedAmount,
    });

    if (claimErr) {
      // 23505 unique_violation → already claimed this game today. Return success
      // with awarded: 0 so the UI flow doesn't break, but credit nothing.
      if (claimErr.code === "23505") {
        return NextResponse.json({
          success: true,
          awarded: 0,
          alreadyClaimed: true,
          newCoins: profile.coins ?? 0,
        });
      }
      console.error("[games/reward POST] claim insert:", claimErr);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    // ── 2. Atomic credit via the RPC (cashable bucket). On failure, compensate
    // by deleting the claim so the user can retry rather than losing the reward.
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: boostedAmount,
      p_min_balance: 0,
      p_source: "cashable",
    });

    if (rpcErr) {
      await supabaseAdmin
        .from("game_rewards")
        .delete()
        .eq("user_id", userId)
        .eq("game_type", gameType)
        .eq("reward_date", rewardDate);
      console.error("[games/reward POST] coin rpc:", rpcErr);
      return NextResponse.json({ error: "Reward failed" }, { status: 500 });
    }

    const newCoins = Array.isArray(rpcData)
      ? (rpcData[0]?.new_coins ?? null)
      : ((rpcData as { new_coins?: number } | null)?.new_coins ?? null);

    // ── 3. Audit row (non-fatal).
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: boostedAmount,
      type: "game_reward",
      description: `${gameType} game reward`,
    });

    return NextResponse.json({ success: true, awarded: boostedAmount, newCoins });
  } catch (e) {
    recordFeatureError("games");
    console.error("[games/reward POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
