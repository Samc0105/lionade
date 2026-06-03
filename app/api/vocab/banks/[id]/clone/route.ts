import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { applyFangMultiplier } from "@/lib/mastery-plan";

/**
 * POST /api/vocab/banks/[id]/clone
 *
 * Deep-copies a public bank into the requester's library by delegating to
 * the SQL `clone_bank(p_bank_id, p_cloner_id)` RPC (built by dev-database
 * in parallel). The RPC is responsible for:
 *   - verifying the source bank is public
 *   - rejecting self-clones
 *   - dedupe slug under (cloner, slug)
 *   - copying vocab_words rows (with parent_word_id wiring per row)
 *   - bumping vocab_banks.clone_count on the source
 *   - returning the NEW bank id (uuid)
 *
 * On success the cloner gets +25 Fangs (multiplier-aware, cashable) as a
 * small "thanks for using community content" reward. The original author
 * does NOT get a payout here — that requires the V3B attribution system.
 *
 * Failure handling:
 *   - RPC errors propagate as a generic 500 with the error logged. We do
 *     NOT attempt to undo a partial clone — the RPC must be atomic; if it
 *     ever leaves a half-state, that's a schema bug to fix at the SQL layer.
 *   - Fang credit failure is non-fatal: the clone stands, we log the drift.
 *     We don't roll back the clone because the user has the new bank in
 *     their UI; pulling the rug would be worse than missing 25 Fangs.
 *
 * Response: { bankId: string, coinsAwarded: number }
 */

type RouteCtx = { params: { id: string } };

const FANG_CLONE_REWARD = 25;

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const bankId = ctx.params.id;
  if (!bankId || typeof bankId !== "string") {
    return NextResponse.json({ error: "Missing bank id" }, { status: 400 });
  }

  // 1. Call the deep-copy RPC. The RPC handles auth-of-source (is_public)
  //    and self-clone rejection itself — we don't pre-flight it here to
  //    keep the operation a single round trip.
  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("clone_bank", {
    p_bank_id: bankId,
    p_cloner_id: userId,
  });

  if (rpcErr) {
    console.error("[vocab/banks/clone rpc]", rpcErr.message);
    // Surface the user-friendly known cases without leaking the raw msg.
    const msg = (rpcErr.message ?? "").toLowerCase();
    if (msg.includes("not public") || msg.includes("not_public")) {
      return NextResponse.json(
        { error: "This bank isn't public anymore" },
        { status: 403 },
      );
    }
    if (msg.includes("self") || msg.includes("own")) {
      return NextResponse.json(
        { error: "You can't clone your own bank" },
        { status: 400 },
      );
    }
    if (msg.includes("not found") || msg.includes("not_found")) {
      return NextResponse.json({ error: "Bank not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Couldn't clone bank" }, { status: 500 });
  }

  // RPC return shape — tolerate both bare-uuid and { new_bank_id } row.
  // Defensive: if SQL author returns SETOF, Supabase yields an array.
  let newBankId: string | null = null;
  if (typeof rpcData === "string") {
    newBankId = rpcData;
  } else if (Array.isArray(rpcData) && rpcData.length > 0) {
    const first = rpcData[0] as Record<string, unknown> | string;
    if (typeof first === "string") {
      newBankId = first;
    } else if (first && typeof first === "object") {
      const v =
        (first as Record<string, unknown>).new_bank_id ??
        (first as Record<string, unknown>).bank_id ??
        (first as Record<string, unknown>).id;
      if (typeof v === "string") newBankId = v;
    }
  } else if (rpcData && typeof rpcData === "object") {
    const v =
      (rpcData as Record<string, unknown>).new_bank_id ??
      (rpcData as Record<string, unknown>).bank_id ??
      (rpcData as Record<string, unknown>).id;
    if (typeof v === "string") newBankId = v;
  }

  if (!newBankId) {
    console.error("[vocab/banks/clone rpc-shape]", JSON.stringify(rpcData));
    return NextResponse.json({ error: "Couldn't clone bank" }, { status: 500 });
  }

  // 2. Fang reward — multiplier-aware, cashable. Non-fatal on failure so we
  //    don't punish the cloner for an unrelated balance hiccup.
  let coinsAwarded = 0;
  const boosted = await applyFangMultiplier(FANG_CLONE_REWARD, userId, supabaseAdmin);
  if (boosted > 0) {
    const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: boosted,
      p_min_balance: 0,
      p_source: "cashable",
    });
    if (creditErr) {
      console.error("[vocab/banks/clone credit]", creditErr.message);
    } else {
      coinsAwarded = boosted;
      await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: boosted,
        type: "vocab_clone",
        reference_id: String(newBankId),
        description: "Cloned a public vocab bank",
      });
    }
  }

  return NextResponse.json({ bankId: newBankId, coinsAwarded });
}
