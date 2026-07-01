// Streak Freeze (streak insurance) — a Fang-purchased item that auto-protects
// the daily streak when a user misses a day.
//
//   GET  /api/streak/freeze  → { available, count, cap, price, coins }
//   POST /api/streak/freeze  → buy ONE freeze with Fangs (server-authoritative)
//
// Storage: profiles.streak_freezes (int, cap 3) + last_freeze_consumed_date
// (idempotency guard, written by /api/streak/expire on auto-consume). Both are
// added by the HELD migration 083. This route FAILS SOFT if the migration is
// not yet applied: a select of the unknown column errors, and we report the
// feature as unavailable ("coming soon") instead of 500ing.
//
// ── Economy (data-economist) ────────────────────────────────────────────────
// PRICE 750 Fangs. A day of casual quizzing nets ~100-200 Fangs, so a freeze is
// ~4-7 days of earning: a real sink, but affordable as retention insurance. It
// sits between the Streak Shield booster (550F, must be armed BEFORE the gap)
// and the panic Streak Revive (5000F, post-hoc). The freeze is the passive,
// auto-consume safety net.
// CAP 3. A user can bank protection for up to 3 separate lapses. A hard cap
// keeps the streak meaningful (a truly absent user still loses it) while giving
// a comfortable buffer, and bounds the max Fang value locked in freezes.
//
// ── Server-authority + anti-abuse ───────────────────────────────────────────
// The Fang debit goes through the atomic update_user_coins RPC (source 'spend').
// The client NEVER grants or holds a freeze — the count lives only in the DB and
// is read back here. Buy is fail-closed: if the counter write fails after the
// debit, we refund via 'spend_refund' (symmetric reversal that also unwinds
// lifetime_fangs_spent), so a user can never pay and receive nothing.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// NOT exported: Next.js App Router route files may only export route handlers
// (GET/POST/...) + its config whitelist. Exporting these consts fails the
// production `next build` route-type check (which tsc --noEmit does not run).
const STREAK_FREEZE_PRICE = 750;
const STREAK_FREEZE_CAP = 3;

// Postgres "column does not exist" (migration not applied yet).
const UNDEFINED_COLUMN = "42703";

// ─────────────────────────────────────────────────────────────────────────────
// GET — current freeze status. Never 500s on a missing column; reports the
// feature as unavailable so the UI can hide/soften itself.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("coins, streak_freezes")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Migration 083 not applied yet -> feature dormant, not an error.
    if (error.code === UNDEFINED_COLUMN) {
      return NextResponse.json({
        available: false,
        count: 0,
        cap: STREAK_FREEZE_CAP,
        price: STREAK_FREEZE_PRICE,
        coins: 0,
      });
    }
    console.error("[streak/freeze GET]", error.message);
    return NextResponse.json({ error: "Couldn't load freezes." }, { status: 500 });
  }

  const count = Math.max(0, Number(profile?.streak_freezes ?? 0));
  return NextResponse.json({
    available: true,
    count,
    cap: STREAK_FREEZE_CAP,
    price: STREAK_FREEZE_PRICE,
    coins: Math.max(0, Number(profile?.coins ?? 0)),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — buy ONE streak freeze with Fangs.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // 1. Read the current count (also our migration-applied probe + cap check).
  const { data: profile, error: readErr } = await supabaseAdmin
    .from("profiles")
    .select("coins, streak_freezes")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    if (readErr.code === UNDEFINED_COLUMN) {
      return NextResponse.json(
        { ok: false, reason: "unavailable", message: "Streak Freeze isn't available yet." },
        { status: 503 },
      );
    }
    console.error("[streak/freeze POST] read:", readErr.message);
    return NextResponse.json({ error: "Purchase failed." }, { status: 500 });
  }

  const currentCount = Math.max(0, Number(profile?.streak_freezes ?? 0));
  const coins = Math.max(0, Number(profile?.coins ?? 0));

  // 2. Cap check BEFORE debiting. A user can hold at most STREAK_FREEZE_CAP.
  if (currentCount >= STREAK_FREEZE_CAP) {
    return NextResponse.json(
      {
        ok: false,
        reason: "at_cap",
        cap: STREAK_FREEZE_CAP,
        count: currentCount,
        message: `You already have the max of ${STREAK_FREEZE_CAP} freezes.`,
      },
      { status: 409 },
    );
  }

  // Friendly pre-check (the RPC below is the real guard).
  if (coins < STREAK_FREEZE_PRICE) {
    return NextResponse.json(
      {
        ok: false,
        reason: "not_enough_fangs",
        price: STREAK_FREEZE_PRICE,
        coins,
        message: `Need ${STREAK_FREEZE_PRICE} Fangs (you have ${coins}).`,
      },
      { status: 402 },
    );
  }

  // 3. Atomic debit (source 'spend'). The RPC is the authoritative floor guard:
  //    P0001 = insufficient funds. Never grants on the client.
  const { error: debitErr } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: userId,
    p_delta: -STREAK_FREEZE_PRICE,
    p_min_balance: 0,
    p_source: "spend",
  });
  if (debitErr) {
    if (debitErr.code === "P0001") {
      return NextResponse.json(
        {
          ok: false,
          reason: "not_enough_fangs",
          price: STREAK_FREEZE_PRICE,
          coins,
          message: `Need ${STREAK_FREEZE_PRICE} Fangs (you have ${coins}).`,
        },
        { status: 402 },
      );
    }
    console.error("[streak/freeze POST] debit:", debitErr.message);
    return NextResponse.json({ error: "Purchase failed." }, { status: 500 });
  }

  // 4. Credit the freeze — CONDITIONAL on still being under the cap, so two
  //    parallel buys can't push the counter past STREAK_FREEZE_CAP. Only the
  //    row whose streak_freezes is still < cap gets incremented; a racing buy
  //    that lost matches 0 rows and is refunded below.
  const { data: creditedRows, error: creditErr } = await supabaseAdmin
    .from("profiles")
    .update({ streak_freezes: currentCount + 1 })
    .eq("id", userId)
    .lt("streak_freezes", STREAK_FREEZE_CAP)
    .select("streak_freezes");

  const credited = !creditErr && (creditedRows?.length ?? 0) > 0;

  if (!credited) {
    // Refund — symmetric 'spend_refund' reversal (credits cashable AND unwinds
    // lifetime_fangs_spent), matching shop/purchase. We never keep Fangs for a
    // freeze we didn't grant.
    await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: STREAK_FREEZE_PRICE,
      p_min_balance: 0,
      p_source: "spend_refund",
    });
    if (creditErr) {
      console.error("[streak/freeze POST] credit failed, refunded:", creditErr.message);
      return NextResponse.json({ error: "Purchase failed, refunded." }, { status: 500 });
    }
    // 0 rows matched the < cap filter -> we hit the cap in a race.
    return NextResponse.json(
      {
        ok: false,
        reason: "at_cap",
        cap: STREAK_FREEZE_CAP,
        count: currentCount,
        message: `You already have the max of ${STREAK_FREEZE_CAP} freezes.`,
      },
      { status: 409 },
    );
  }

  const newCount = Number(creditedRows?.[0]?.streak_freezes ?? currentCount + 1);

  // 5. Audit (best-effort).
  try {
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: -STREAK_FREEZE_PRICE,
      type: "shop_purchase",
      description: "Purchased Streak Freeze",
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    ok: true,
    count: newCount,
    cap: STREAK_FREEZE_CAP,
    coins: coins - STREAK_FREEZE_PRICE,
  });
}
