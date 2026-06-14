// GET /api/cron/expire-grants — Vercel cron entry point.
//
// Fires daily (see vercel.json). plan_grants expiry is lazy: a grant with a
// past expires_at is already treated as inactive by the resolver, but
// profiles.plan is a CACHED effective value that only changes when something
// CALLS recomputeEffectivePlan. So a user whose only entitlement was a grant
// that lapsed overnight would keep their elevated profiles.plan until the next
// webhook or grant action touched them. This sweep closes that gap: it finds
// every user with a grant that expired (and is not revoked) and recomputes
// their effective plan so they drop to their Stripe baseline.
//
// --- Auth (copied verbatim from academia-digest / reap-afk-presence) -------
// Vercel sends the cron secret as `Authorization: Bearer $CRON_SECRET`.
// HEADER-ONLY (no query-string fallback — secrets must never land in logs).
// Constant-time compare via node:crypto timingSafeEqual. 500 if the secret is
// unset (failure-closed), 401 on mismatch.
//
// --- Idempotency -----------------------------------------------------------
// recomputeEffectivePlan is idempotent (it reads current truth and writes
// profiles.plan only when it differs). Running this sweep twice is harmless;
// it just re-confirms the same values. We dedupe the candidate user set so we
// never recompute the same user twice within one run.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { recomputeEffectivePlan } from "@/lib/plan-grants";
import { putCronHeartbeat } from "@/lib/cloudwatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Safety bound on candidates per run. Expired-grant users are a small set;
// this is a guardrail, not a paging cursor.
const MAX_USERS_PER_RUN = 1000;

export async function GET(req: NextRequest) {
  // --- 1. Auth -----------------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/expire-grants] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const aBuf = Buffer.from(authHeader);
  const eBuf = Buffer.from(expected);
  if (aBuf.length !== eBuf.length || !timingSafeEqual(aBuf, eBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  try {
    // --- 2. Candidate users ---------------------------------------------
    // Grants that have lapsed: expires_at in the past, not soft-revoked. These
    // are exactly the rows that just fell out of the resolver's "active" set,
    // so any user holding only these may have a stale (still-elevated)
    // profiles.plan. We recompute every distinct such user; the resolver no-ops
    // anyone whose plan is already correct (e.g. still covered by Stripe or a
    // lifetime grant).
    const { data: expired, error: expiredErr } = await supabaseAdmin
      .from("plan_grants")
      .select("user_id")
      .is("revoked_at", null)
      .not("expires_at", "is", null)
      .lte("expires_at", nowIso)
      .limit(MAX_USERS_PER_RUN);

    if (expiredErr) {
      console.error("[cron/expire-grants]", expiredErr.message);
      return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((expired ?? []).map((r) => (r as { user_id: string }).user_id)),
    );

    let recomputed = 0;
    let downgraded = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        // Read the cached plan first so we can count how many actually dropped.
        const { data: before } = await supabaseAdmin
          .from("profiles")
          .select("plan")
          .eq("id", userId)
          .single();
        // Normalize the same way the resolver does (asPlan) so the downgraded
        // count compares like-for-like and never miscounts a legacy/stray
        // profiles.plan string as a transition.
        const rawBefore = (before as { plan?: string } | null)?.plan;
        const beforePlan =
          rawBefore === "pro" || rawBefore === "platinum" ? rawBefore : "free";

        const effective = await recomputeEffectivePlan(userId);
        recomputed++;
        if (effective !== beforePlan) downgraded++;
      } catch (e) {
        // One bad user must not abort the sweep.
        console.error(
          "[cron/expire-grants] recompute failed",
          userId,
          e instanceof Error ? e.message : "unknown",
        );
        failed++;
      }
    }

    const summary = {
      ok: true,
      candidates: userIds.length,
      recomputed,
      downgraded,
      failed,
    };
    console.log("[cron/expire-grants] done", JSON.stringify(summary));
    await putCronHeartbeat("expire-grants");
    return NextResponse.json(summary);
  } catch (e) {
    console.error(
      "[cron/expire-grants] unexpected",
      e instanceof Error ? e.message : "unknown",
    );
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
