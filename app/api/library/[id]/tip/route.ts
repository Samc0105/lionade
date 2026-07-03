// POST /api/library/[id]/tip — upside-only Fang gift to a public set's creator.
//
// Body: { amount: 25 | 50 | 100 }
//
// Money movement (server-authoritative, dual-ledger):
//   1. DEBIT tipper:  update_user_coins(p_delta: -amount, p_min_balance: 0,
//                     p_source: "tip_spend") — CASHABLE ONLY, never dips into
//                     iap Fangs (blocks iap -> cashable laundering through the
//                     credit in step 3) and never counts toward
//                     lifetime_fangs_spent (tips are transfers, not
//                     consumption — counting them would let paired accounts
//                     pump the cash-out eligibility gate).
//        * P0001 "insufficient_coins" -> 400 "Not enough Fangs."
//        * P0001 "invalid_source" (HELD migration 20260702090000 unapplied —
//          the deployed RPC doesn't know tip_spend yet): NOTHING moved, return
//          200 { tipsPending: true } with honest copy. No refund needed.
//   2. LEDGER sent:   coin_transactions type "set_tip_sent" (-amount).
//        * 23514 (type not in the CHECK allowlist -> HELD migration
//          20260702090000 unapplied): REFUND the debit via p_source "cashable"
//          (NOT spend_refund — tip_spend never touched lifetime_fangs_spent,
//          so spend_refund's counter unwind would corrupt it downward) and
//          return 200 { tipsPending: true }. Net zero movement, zero ledger
//          rows — dual-ledger stays consistent, and the UI disables tipping
//          for the session.
//   3. CREDIT creator: update_user_coins(+amount, p_source: "cashable",
//          service role). Failure -> delete the sent ledger row + refund the
//          tipper (spend_refund) -> 500. No half-tips.
//   4. LEDGER received: type "set_tip_received" (+amount). If step 2 passed,
//          the allowlist provably contains both types, so a failure here is an
//          infra blip: balance already moved, never claw back for an audit-row
//          miss — log loudly for the reconciler (focus-rooms base-pay parity).
//
// Guards: demo-block, no self-tipping, set must exist and be public, amount
// allowlist, and a cap of MAX_TIPS_PER_DAY set_tip_sent rows per UTC day.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import {
  isMissingLibrarySchema,
  libraryUnavailableResponse,
} from "@/lib/library/schema-guard";
import {
  TIP_AMOUNTS,
  MAX_TIPS_PER_DAY,
  STUDY_SETS_TABLE,
  type TipAmount,
} from "@/lib/library/constants";

const TIPS_PENDING_COPY =
  "Tipping isn't switched on yet. Your Fangs were returned.";
const TIPS_PENDING_NOTHING_MOVED_COPY =
  "Tipping isn't switched on yet. No Fangs left your balance.";

async function refundTipper(userId: string, amount: number): Promise<void> {
  // p_source "cashable" exactly reverses a tip_spend debit: both touch coins +
  // fangs_cashable only. NOT "spend_refund" — that unwinds lifetime_fangs_spent,
  // which tip_spend never incremented, so it would corrupt the counter downward.
  const { error } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: userId,
    p_delta: amount,
    p_min_balance: 0,
    p_source: "cashable",
  });
  if (error) {
    // Worst case for the user — debit went through, refund failed. Loud log
    // so the balance reconciler (075) surfaces it.
    console.error("[library/tip] REFUND FAILED", userId, amount, error.message);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  if (isDemoUser(userId)) return demoBlockedResponse();

  const setId = params.id;
  if (!setId || typeof setId !== "string") {
    return NextResponse.json({ error: "Missing set id" }, { status: 400 });
  }

  let amount: TipAmount | null = null;
  try {
    const body = (await req.json()) as { amount?: unknown } | null;
    if (typeof body?.amount === "number" && (TIP_AMOUNTS as readonly number[]).includes(body.amount)) {
      amount = body.amount as TipAmount;
    }
  } catch {
    // fall through to the 400 below
  }
  if (amount === null) {
    return NextResponse.json(
      { error: "Tips are 25, 50, or 100 Fangs." },
      { status: 400 },
    );
  }

  // ── Set + creator ───────────────────────────────────────────────────────
  const { data: set, error: setErr } = await supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .select("id, user_id, title, is_public")
    .eq("id", setId)
    .maybeSingle();
  if (setErr) {
    if (isMissingLibrarySchema(setErr)) return libraryUnavailableResponse();
    console.error("[library/tip] set lookup", setErr.message);
    return NextResponse.json({ error: "Couldn't send the tip." }, { status: 500 });
  }
  if (!set || set.is_public !== true) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const creatorId = set.user_id as string;
  if (creatorId === userId) {
    return NextResponse.json({ error: "You can't tip your own set." }, { status: 400 });
  }

  // ── Daily cap (counted off the ledger — the source of truth) ────────────
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { count: tipsToday, error: capErr } = await supabaseAdmin
    .from("coin_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "set_tip_sent")
    .gte("created_at", `${todayUtc}T00:00:00.000Z`);
  if (capErr) {
    console.error("[library/tip] cap count", capErr.message);
    return NextResponse.json({ error: "Couldn't send the tip." }, { status: 500 });
  }
  if ((tipsToday ?? 0) >= MAX_TIPS_PER_DAY) {
    return NextResponse.json(
      { error: `You can send ${MAX_TIPS_PER_DAY} tips a day. Come back tomorrow.`, capped: true },
      { status: 429 },
    );
  }

  // Double-submit guard: a duplicate tip to the SAME set within 10 seconds is
  // almost certainly a double-click, not intent - refuse it so a laggy button
  // can't cost the user twice (reviewer minor). Deliberate repeat tips after
  // the window still work.
  const { data: recentTip } = await supabaseAdmin
    .from("coin_transactions")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "set_tip_sent")
    .eq("reference_id", setId)
    .gte("created_at", new Date(Date.now() - 10_000).toISOString())
    .limit(1);
  if (recentTip && recentTip.length > 0) {
    return NextResponse.json(
      { error: "You just tipped this set. Give it a few seconds.", duplicate: true },
      { status: 429 },
    );
  }

  const title = typeof set.title === "string" ? set.title.slice(0, 80) : "a study set";

  // ── 1) Debit tipper (cashable only — see header) ────────────────────────
  const { error: debitErr } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: userId,
    p_delta: -amount,
    p_min_balance: 0,
    p_source: "tip_spend",
  });
  if (debitErr) {
    if (debitErr.code === "P0001") {
      if (debitErr.message?.includes("invalid_source")) {
        // Deployed RPC predates the tip_spend source (HELD migration
        // 20260702090000 unapplied). It raised BEFORE any balance moved, so
        // there is nothing to refund. Honest copy, tipping self-disables.
        return NextResponse.json({
          ok: false,
          tipsPending: true,
          message: TIPS_PENDING_NOTHING_MOVED_COPY,
        });
      }
      return NextResponse.json({ error: "Not enough Fangs." }, { status: 400 });
    }
    console.error("[library/tip] debit", debitErr.message);
    return NextResponse.json({ error: "Couldn't send the tip." }, { status: 500 });
  }

  // ── 2) Sent ledger (the HELD-migration fail-soft gate) ──────────────────
  const { data: sentRow, error: sentErr } = await supabaseAdmin
    .from("coin_transactions")
    .insert({
      user_id: userId,
      amount: -amount,
      type: "set_tip_sent",
      reference_id: setId,
      description: `Tipped the creator of "${title}"`,
    })
    .select("id")
    .single();
  if (sentErr || !sentRow) {
    await refundTipper(userId, amount);
    if (sentErr?.code === "23514") {
      // Ledger type allowlist doesn't include set_tip_sent yet (migration
      // 20260702090000 HELD). Honest copy, money returned, nothing ledgered.
      return NextResponse.json({ ok: false, tipsPending: true, message: TIPS_PENDING_COPY });
    }
    console.error("[library/tip] sent ledger", sentErr?.message ?? "no row");
    return NextResponse.json({ error: "Couldn't send the tip." }, { status: 500 });
  }

  // ── 3) Credit creator (service-role cashable) ───────────────────────────
  const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: creatorId,
    p_delta: amount,
    p_min_balance: 0,
    p_source: "cashable",
  });
  if (creditErr) {
    console.error("[library/tip] credit", creditErr.message);
    // Full unwind: no half-tips. Remove the sent ledger row, refund the spend.
    await supabaseAdmin.from("coin_transactions").delete().eq("id", sentRow.id);
    await refundTipper(userId, amount);
    return NextResponse.json({ error: "Couldn't send the tip." }, { status: 500 });
  }

  // ── 4) Received ledger ──────────────────────────────────────────────────
  const { error: receivedErr } = await supabaseAdmin.from("coin_transactions").insert({
    user_id: creatorId,
    amount,
    type: "set_tip_received",
    reference_id: setId,
    description: `Received a tip for "${title}"`,
  });
  if (receivedErr) {
    // Both balances already moved; never claw back over an audit-row miss.
    console.error("[library/tip] received ledger MISSING", creatorId, setId, receivedErr.message);
  }

  return NextResponse.json({
    ok: true,
    tipsPending: false,
    amount,
    tipsToday: (tipsToday ?? 0) + 1,
    cap: MAX_TIPS_PER_DAY,
  });
}
