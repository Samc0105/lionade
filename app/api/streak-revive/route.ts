import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * Streak Revive — Snapchat-style post-hoc streak restoration.
 *
 * GET  /api/streak-revive  → status of the user's currently OPEN revive
 *                            window, or { open: false } if none.
 * POST /api/streak-revive  → claim the open revive. Body: { method: 'fangs' | 'cash' }
 *
 * The window is opened automatically by `lib/hooks.resetExpiredStreak`
 * when a user's streak breaks. There is at most one open revive per
 * user (DB-enforced via a unique partial index). Users cannot stockpile
 * — opening a second window requires the streak to break again.
 *
 * Cash ($0.99) is gated behind a Stripe rollout — for now, returns a
 * "coming soon" response. The Fangs path (5,000F) is fully wired.
 */

const REVIVE_COST_FANGS = 5000;
const REVIVE_COST_CENTS = 99;

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-expire any open windows that ran out without a claim. Avoids needing
// a cron job — every read does this cheaply for the calling user.
// ─────────────────────────────────────────────────────────────────────────────
async function expireStaleWindows(userId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("streak_revives")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "open")
    .lt("expires_at", nowIso);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — current revive status
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    await expireStaleWindows(userId);

    const { data, error } = await supabaseAdmin
      .from("streak_revives")
      .select("id, previous_streak, opened_at, expires_at")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[streak-revive GET]", error.message);
      return NextResponse.json({ error: "Couldn't load revive status." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({
        open: false,
        costFangs: REVIVE_COST_FANGS,
        costCents: REVIVE_COST_CENTS,
      });
    }

    const expiresMs = new Date(data.expires_at).getTime();
    const remainingMs = Math.max(0, expiresMs - Date.now());

    // Pull coins so the UI can decide if Fangs path is viable without an
    // extra round-trip.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .maybeSingle();

    return NextResponse.json({
      open: true,
      reviveId: data.id,
      previousStreak: data.previous_streak,
      openedAt: data.opened_at,
      expiresAt: data.expires_at,
      remainingMs,
      costFangs: REVIVE_COST_FANGS,
      costCents: REVIVE_COST_CENTS,
      coins: profile?.coins ?? 0,
    });
  } catch (e) {
    console.error("[streak-revive GET]", e);
    return NextResponse.json({ error: "Couldn't load revive status." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — claim the open revive
// ─────────────────────────────────────────────────────────────────────────────
interface ClaimBody {
  method: "fangs" | "cash";
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: ClaimBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.method !== "fangs" && body.method !== "cash") {
    return NextResponse.json({ error: "Pick a payment method." }, { status: 400 });
  }

  // Stripe is not wired yet — block the cash path with a clear message
  // instead of a silent fail. UI surfaces this as a toast.
  if (body.method === "cash") {
    return NextResponse.json({
      ok: false,
      reason: "cash_unavailable",
      message: "Cash purchases roll out with our Stripe launch. For now, revive with Fangs.",
    }, { status: 501 });
  }

  try {
    await expireStaleWindows(userId);

    // Lock the open revive row.
    const { data: revive, error: revErr } = await supabaseAdmin
      .from("streak_revives")
      .select("id, previous_streak, expires_at")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (revErr) {
      console.error("[streak-revive POST] read:", revErr.message);
      return NextResponse.json({ error: "Couldn't load revive." }, { status: 500 });
    }
    if (!revive) {
      return NextResponse.json({
        ok: false,
        reason: "no_open_revive",
        message: "No revive window is open right now.",
      }, { status: 410 });
    }
    if (Date.now() > new Date(revive.expires_at).getTime()) {
      // Race: expired between read and now. Flip status, fail.
      await supabaseAdmin.from("streak_revives")
        .update({ status: "expired" }).eq("id", revive.id);
      return NextResponse.json({
        ok: false,
        reason: "expired",
        message: "This revive window just expired.",
      }, { status: 410 });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .maybeSingle();
    const coins = profile?.coins ?? 0;

    if (coins < REVIVE_COST_FANGS) {
      return NextResponse.json({
        ok: false,
        reason: "not_enough_fangs",
        costFangs: REVIVE_COST_FANGS,
        coins,
        message: `Need ${REVIVE_COST_FANGS} Fangs (you have ${coins}).`,
      }, { status: 402 });
    }

    const nowIso = new Date().toISOString();

    // 1. Spend the Fangs atomically. The RPC is the real guard (the pre-check
    //    above is only for the friendly message); it never goes below 0.
    const { data: spendData, error: spendErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: -REVIVE_COST_FANGS,
      p_min_balance: 0,
      p_source: "spend",
    });
    if (spendErr) {
      if (spendErr.code === "P0001") {
        return NextResponse.json({
          ok: false,
          reason: "not_enough_fangs",
          costFangs: REVIVE_COST_FANGS,
          coins,
          message: `Need ${REVIVE_COST_FANGS} Fangs (you have ${coins}).`,
        }, { status: 402 });
      }
      console.error("[streak-revive POST] spend:", spendErr.message);
      return NextResponse.json({ error: "Couldn't restore streak." }, { status: 500 });
    }
    const newBalance = Array.isArray(spendData)
      ? (spendData[0]?.new_coins ?? coins - REVIVE_COST_FANGS)
      : ((spendData as { new_coins?: number } | null)?.new_coins ?? coins - REVIVE_COST_FANGS);

    // 2. Conditionally claim the revive BEFORE touching the streak. The
    //    `.eq('status','open').select()` makes this atomic: only the first
    //    claimer wins; a concurrent double-spend that loses here refunds.
    //    (The old code set streak:0/last_activity:null on failure here, nuking
    //    the very streak the user paid 5000 Fangs to revive.)
    const { data: claimRows, error: claimErr } = await supabaseAdmin
      .from("streak_revives")
      .update({
        status: "claimed",
        claimed_at: nowIso,
        claim_method: "fangs",
        fangs_spent: REVIVE_COST_FANGS,
      })
      .eq("id", revive.id)
      .eq("status", "open")
      .select("id");
    if (claimErr) {
      console.error("[streak-revive POST] claim:", claimErr.message);
      await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId, p_delta: REVIVE_COST_FANGS, p_min_balance: 0, p_source: "spend_refund",
      });
      return NextResponse.json({ error: "Couldn't finalize revive." }, { status: 500 });
    }
    if (!claimRows || claimRows.length === 0) {
      // A concurrent request already claimed this revive — refund our spend.
      await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId, p_delta: REVIVE_COST_FANGS, p_min_balance: 0, p_source: "spend_refund",
      });
      return NextResponse.json({
        ok: false,
        reason: "already_claimed",
        message: "This streak was just revived.",
      }, { status: 409 });
    }

    // 3. Restore the streak (the deliverable). On failure: refund + re-open the
    //    revive so the user can retry. The streak was never set, so there is
    //    nothing to revert and nothing to nuke.
    const { error: streakErr } = await supabaseAdmin
      .from("profiles")
      .update({ streak: revive.previous_streak, last_activity_at: nowIso })
      .eq("id", userId);
    if (streakErr) {
      console.error("[streak-revive POST] streak restore:", streakErr.message);
      await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId, p_delta: REVIVE_COST_FANGS, p_min_balance: 0, p_source: "spend_refund",
      });
      await supabaseAdmin
        .from("streak_revives")
        .update({ status: "open", claimed_at: null, claim_method: null, fangs_spent: null })
        .eq("id", revive.id);
      return NextResponse.json({ error: "Couldn't restore streak." }, { status: 500 });
    }

    // Audit (best-effort).
    void supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: -REVIVE_COST_FANGS,
      type: "streak_revive",
      description: `Revived ${revive.previous_streak}-day streak`,
    });

    return NextResponse.json({
      ok: true,
      restoredStreak: revive.previous_streak,
      coins: newBalance,
    });
  } catch (e) {
    console.error("[streak-revive POST]", e);
    return NextResponse.json({ error: "Couldn't restore streak." }, { status: 500 });
  }
}
