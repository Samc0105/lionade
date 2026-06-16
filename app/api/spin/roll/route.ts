import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { assertFeatureLive } from "@/lib/feature-flags";
import { recordFeatureError } from "@/lib/feature-health";
import {
  rollSlot,
  computeReward,
  canSpinNow,
  nextSpinAt,
  SPIN_SLOTS,
  SPIN_COOLDOWN_MS,
  type SpinOutcome,
} from "@/lib/spin";
import { effectiveTier, multiplierForTier } from "@/lib/mastery-plan";

export const dynamic = "force-dynamic";

/**
 * POST /api/spin/roll
 *
 * The actual spin. Server-rolls, applies the Fangs delta, grants any
 * payload (booster / cosmetic / streak shield), writes the audit row,
 * and returns the outcome + new balance.
 *
 * Guarantees:
 *   - Server-side RNG (crypto.randomInt) — outcome cannot be tampered with.
 *   - Cooldown re-checked here even though the UI also checks via
 *     /api/spin/status. Status is advisory; this is authoritative.
 *   - Bust never pushes balance below 0 (clamp).
 *   - Tax Man uses the SERVER-side current balance — pre-spending to dodge
 *     it doesn't work, but it does honestly mean the loss is smaller.
 *   - Plan multiplier (Pro +25%, Platinum +50%) applies to POSITIVE Fangs
 *     payouts only. Bust and Tax Man are the same for everyone.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const m = await assertFeatureLive("shop.daily_spin");
  if (m) return m;

  // ── 1. Cooldown re-check ────────────────────────────────────────────────
  const { data: lastSpin } = await supabaseAdmin
    .from("daily_spins")
    .select("spun_at")
    .eq("user_id", userId)
    .order("spun_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastSpunAt = lastSpin?.spun_at ? new Date(lastSpin.spun_at) : null;
  if (!canSpinNow(lastSpunAt)) {
    return NextResponse.json(
      {
        error: "Cooldown active",
        nextSpinAt: nextSpinAt(lastSpunAt)?.toISOString() ?? null,
      },
      { status: 429 },
    );
  }

  // Atomic race-guard: the read-check above is advisory; this serializes
  // concurrent spins so two can't both pass it and double-pay (up to 800F + a
  // rare cosmetic). claim_cooldown is the authoritative gate.
  const { data: spinClaimed } = await supabaseAdmin.rpc("claim_cooldown", {
    p_user_id: userId,
    p_kind: "spin",
    p_cooldown_seconds: Math.floor(SPIN_COOLDOWN_MS / 1000),
  });
  if (spinClaimed !== true) {
    return NextResponse.json(
      { error: "Cooldown active", nextSpinAt: nextSpinAt(lastSpunAt)?.toISOString() ?? null },
      { status: 429 },
    );
  }

  // ── 2. Load current balance + plan ──────────────────────────────────────
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("coins, plan, subscription_status")
    .eq("id", userId)
    .single();
  if (profileErr || !profile) {
    recordFeatureError("shop.daily_spin");
    console.error("[spin/roll] profile load:", profileErr?.message);
    return NextResponse.json({ error: "Profile not found" }, { status: 500 });
  }

  const balanceBefore: number = profile.coins ?? 0;
  // PLAN_FANG_MULTIPLIER (1×/1.5×/2×), past_due/canceled revert to free.
  const planMultiplier = multiplierForTier(effectiveTier(profile.plan, profile.subscription_status));

  // ── 3. Roll the slot ────────────────────────────────────────────────────
  const { index: slotIndex, slot } = rollSlot();
  let outcome: SpinOutcome = slot.outcome;
  let { fangsDelta, rewardPayload } = computeReward(outcome, balanceBefore, planMultiplier);

  // ── 4. Special-case: rare_cosmetic without an unowned item ─────────────
  // Pick a rare cosmetic the user doesn't already own. If they own all of
  // them, fall back to an 800F payout (and adjust the outcome+payload
  // honestly so the audit row reflects what actually happened).
  if (outcome === "rare_cosmetic") {
    const RARE_POOL = ["frame_fire", "name_emerald", "banner_warrior", "boost_lucky_start"];
    const { data: owned } = await supabaseAdmin
      .from("user_inventory")
      .select("item_id")
      .eq("user_id", userId)
      .in("item_id", RARE_POOL);
    const ownedIds = new Set((owned ?? []).map((r: { item_id: string }) => r.item_id));
    const unowned = RARE_POOL.filter((id) => !ownedIds.has(id));

    if (unowned.length > 0) {
      const { randomInt } = await import("node:crypto");
      const pickedId = unowned[randomInt(0, unowned.length)];
      rewardPayload = { kind: "rare_cosmetic", itemId: pickedId };
    } else {
      // User has everything, convert to a flat 800F payout.
      outcome = "big_fangs";
      fangsDelta = Math.round(800 * planMultiplier);
      rewardPayload = { kind: "rare_cosmetic_fallback" };
    }
  }

  // ── 5. Apply the Fangs delta ────────────────────────────────────────────
  // Atomic credit/debit. If a Bust would push them below 0, the first RPC
  // call rejects with P0001 and we fall back to a clamped delta of
  // -fresh_balance (zeroing them out). UI shows the honest "you only had X".
  let balanceAfter: number;
  let actualDelta: number;
  const { data: spinData, error: spinUpdateErr } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: userId,
    p_delta: fangsDelta,
    p_min_balance: 0,
    p_source: "cashable",
  });

  if (spinUpdateErr && spinUpdateErr.code === "P0001") {
    // Bust larger than balance — zero them out via a fresh re-read.
    const { data: freshProfile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();
    const freshBalance: number = freshProfile?.coins ?? 0;
    if (freshBalance > 0) {
      const { data: zeroData, error: zeroErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: -freshBalance,
        p_min_balance: 0,
        p_source: "spend",
      });
      if (zeroErr) {
        recordFeatureError("shop.daily_spin");
        console.error("[spin/roll] zero-out:", zeroErr.message);
        return NextResponse.json({ error: "Couldn't update balance" }, { status: 500 });
      }
      balanceAfter = Array.isArray(zeroData) ? zeroData[0]?.new_coins : (zeroData as { new_coins: number } | null)?.new_coins ?? 0;
    } else {
      balanceAfter = 0;
    }
    actualDelta = balanceAfter - balanceBefore;
  } else if (spinUpdateErr) {
    recordFeatureError("shop.daily_spin");
    console.error("[spin/roll] coin update:", spinUpdateErr.message);
    return NextResponse.json({ error: "Couldn't update balance" }, { status: 500 });
  } else {
    balanceAfter = Array.isArray(spinData) ? spinData[0]?.new_coins : (spinData as { new_coins: number } | null)?.new_coins ?? balanceBefore + fangsDelta;
    actualDelta = balanceAfter - balanceBefore;
  }

  // ── 6. Grant side-rewards (booster, streak shield, cosmetic) ────────────
  if (rewardPayload) {
    if (rewardPayload.kind === "booster" && typeof rewardPayload.boosterId === "string") {
      await supabaseAdmin.from("user_inventory").upsert(
        { user_id: userId, item_id: rewardPayload.boosterId, quantity: 1 },
        { onConflict: "user_id,item_id", ignoreDuplicates: false },
      );
    } else if (rewardPayload.kind === "streak_shield") {
      await supabaseAdmin.from("user_inventory").upsert(
        { user_id: userId, item_id: "boost_streak_shield", quantity: 1 },
        { onConflict: "user_id,item_id", ignoreDuplicates: false },
      );
    } else if (rewardPayload.kind === "rare_cosmetic" && typeof rewardPayload.itemId === "string") {
      await supabaseAdmin.from("user_inventory").upsert(
        { user_id: userId, item_id: rewardPayload.itemId, quantity: 1 },
        { onConflict: "user_id,item_id", ignoreDuplicates: false },
      );
    }
  }

  // ── 7. Write audit rows (daily_spins + coin_transactions) ──────────────
  const spinInsert = supabaseAdmin.from("daily_spins").insert({
    user_id: userId,
    outcome,
    fangs_delta: actualDelta,
    reward_payload: rewardPayload,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
  });
  const txInsert =
    actualDelta !== 0
      ? supabaseAdmin.from("coin_transactions").insert({
          user_id: userId,
          amount: actualDelta,
          type: "daily_spin",
          description: `Daily Spin · ${outcome}`,
        })
      : Promise.resolve({ error: null });

  // Best-effort — if the audit write fails, the user has already received
  // (or lost) their Fangs. Log loudly but don't reverse — the spin happened.
  const [{ error: spinErr }, { error: txErr }] = await Promise.all([spinInsert, txInsert]);
  if (spinErr) console.error("[spin/roll] daily_spins insert:", spinErr.message);
  if (txErr) console.error("[spin/roll] coin_transactions insert:", txErr.message);

  // ── 8. Return the result ────────────────────────────────────────────────
  return NextResponse.json({
    outcome,
    slotIndex: SPIN_SLOTS.findIndex((s) => s.outcome === outcome),
    fangsDelta: actualDelta,
    intendedDelta: fangsDelta, // for honest "you only had X" UI when clamped
    balanceBefore,
    balanceAfter,
    rewardPayload,
  });
}
