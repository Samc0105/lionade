// GET /api/cron/expire-daily-bets — Vercel cron entry point.
//
// A Daily Bet debits the stake on placement (place-bet) and resolves ONLY when
// the user later finishes a quiz (save-quiz-results). If they abandon it — log
// out, switch device, never play — the stake sits debited forever with no
// resolution path. The Compete audit found a live victim: one bet open 33 days
// with 10 Fangs locked. This cron voids + REFUNDS any bet left unresolved past
// EXPIRE_MS so an abandoned stake is always returned.
//
// Idempotency / no double-resolve: each bet is claimed via the SAME
// `resolved_at IS NULL` compare-and-set the quiz settle uses
// (save-quiz-results), so the cron and a concurrent quiz-finish can never both
// resolve the same bet — exactly one flips resolved_at, the other is skipped.
//
// Auth is HEADER-ONLY (Authorization: Bearer $CRON_SECRET), constant-time
// compared — same as reap-stale-competitive. The secret must never appear in a
// query string (access logs).

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { putCronHeartbeat } from "@/lib/cloudwatch";

// A daily bet should resolve same-session; unresolved past 12h is abandoned.
const EXPIRE_MS = 12 * 60 * 60 * 1000;
// Bound one invocation so a backlog can't run the lambda long.
const MAX_PER_RUN = 100;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/expire-daily-bets] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const aBuf = Buffer.from(authHeader);
  const eBuf = Buffer.from(expected);
  if (aBuf.length !== eBuf.length || !timingSafeEqual(aBuf, eBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - EXPIRE_MS).toISOString();
    const { data: stale, error: staleErr } = await supabaseAdmin
      .from("daily_bets")
      .select("id, user_id, coins_staked")
      .is("resolved_at", null)
      .lt("placed_at", cutoff)
      .limit(MAX_PER_RUN);
    if (staleErr) {
      console.error("[cron/expire-daily-bets] fetch:", staleErr.message);
      return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
    }

    let refunded = 0;
    let refundedFangs = 0;
    let skipped = 0;

    for (const bet of stale ?? []) {
      // Atomic claim — only the caller that flips resolved_at off NULL proceeds
      // to refund. A bet the quiz-settle is already resolving is skipped here.
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("daily_bets")
        .update({ resolved_at: new Date().toISOString(), won: false, coins_won: 0 })
        .eq("id", bet.id)
        .is("resolved_at", null)
        .select("id")
        .maybeSingle();
      if (claimErr || !claimed) {
        skipped++;
        continue;
      }

      // Refund the stake. spend_refund reverses the original 'spend' debit
      // (credits cashable + unwinds lifetime_fangs_spent) — same primitive
      // place-bet uses when the bet insert fails.
      const { error: refundErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: bet.user_id,
        p_delta: bet.coins_staked,
        p_min_balance: 0,
        p_source: "spend_refund",
      });
      if (refundErr) {
        // The bet is already marked resolved; a failed refund is a money-desync
        // needing manual repair. Rare — log loudly with specifics.
        console.error(
          "[cron/expire-daily-bets] refund failed after claim",
          refundErr.message,
          { betId: bet.id, userId: bet.user_id, amount: bet.coins_staked },
        );
        continue;
      }

      // Best-effort audit row (balance above is authoritative). Warn on failure
      // — 'bet_refunded' is a brand-new ledger type, so a silent reject here
      // would leave a real refund with no ledger row and we'd never know.
      const { error: auditErr } = await supabaseAdmin.from("coin_transactions").insert({
        user_id: bet.user_id,
        amount: bet.coins_staked,
        type: "bet_refunded",
        reference_id: bet.id,
        description: `Daily bet expired unresolved — refunded ${bet.coins_staked} Fangs`,
      });
      if (auditErr) {
        console.warn("[cron/expire-daily-bets] audit row insert:", auditErr.message, { betId: bet.id });
      }
      refunded++;
      refundedFangs += bet.coins_staked;
    }

    await putCronHeartbeat("expire-daily-bets");
    return NextResponse.json({
      ok: true,
      scanned: (stale ?? []).length,
      refunded,
      refundedFangs,
      skipped,
    });
  } catch (err) {
    console.error("[cron/expire-daily-bets]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
