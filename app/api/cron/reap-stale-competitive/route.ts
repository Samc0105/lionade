// GET /api/cron/reap-stale-competitive — Vercel cron entry point.
//
// Resolves hung / AFK competitive matches so a match can never hang forever.
// A match is "stale" when it is still 'active' and its most recent activity is
// older than the staleness window:
//   - last competitive_response older than RESPONSE_STALE_MS (~3 min), OR
//   - if it never got a response at all, created_at older than CREATED_STALE_MS
//     (20 min — a match nobody ever engaged with).
//
// Each stale match is resolved through the SAME engagement gate as /complete
// and /forfeit (lib/competitive/settle.ts):
//   - one side never engaged  → VOID (no ELO, no Fangs, no penalty)
//   - both engaged            → settle normally (missing rounds already scored 0
//                               in competitive_responses → the AFK side loses)
//
// Idempotency: we only ever touch rows via the atomic active → completing claim
// (the exact claim /complete + /forfeit use), so a row another path is already
// settling is skipped here. Running the cron twice in the same window is safe.
//
// Auth is HEADER-ONLY (Authorization: Bearer $CRON_SECRET), constant-time
// compared — copied from /api/cron/reap-afk-presence. The secret must never
// appear in a query string (access logs / monitoring).

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { settleClaimedMatch } from "@/lib/competitive/settle";
import type { CompetitiveMatchRow } from "@/lib/competitive/types";
import { putCronHeartbeat } from "@/lib/cloudwatch";

// Tuneable staleness windows.
const RESPONSE_STALE_MS = 3 * 60 * 1000; // 3 min since the last answer
const CREATED_STALE_MS = 20 * 60 * 1000; // 20 min since match creation (no-show)
// Cap how many we resolve per invocation so one cron tick can't run long.
const MAX_PER_RUN = 50;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/reap-stale-competitive] CRON_SECRET not configured");
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
    const now = Date.now();
    const createdCutoff = new Date(now - CREATED_STALE_MS).toISOString();
    const responseCutoffTs = now - RESPONSE_STALE_MS;

    // Candidate set: still-active matches at least RESPONSE_STALE_MS old. We
    // pull a bounded window of the oldest-active rows, then decide staleness
    // per-row using their last response timestamp.
    const { data: actives, error: activesErr } = await supabaseAdmin
      .from("competitive_matches")
      .select("*")
      .eq("status", "active")
      .lt("created_at", new Date(responseCutoffTs).toISOString())
      .order("created_at", { ascending: true })
      .limit(MAX_PER_RUN);

    // Guard the candidate fetch BEFORE the success heartbeat — else a silent DB
    // read failure would emit a green heartbeat and blind the dead-man's switch.
    if (activesErr) {
      console.error("[cron/reap-stale-competitive]", activesErr.message);
      return NextResponse.json({ error: "Reap failed" }, { status: 500 });
    }

    // Batch the last-activity lookup into ONE query (was N+1 — a separate
    // SELECT per active match, paying the network round-trip tax 50x). Pull
    // every candidate match's responses newest-first and keep the first
    // submitted_at seen per match_id (= its latest response).
    const candidateIds = (actives ?? []).map((m) => m.id);
    const lastRespByMatch = new Map<string, string>();
    if (candidateIds.length > 0) {
      const { data: resps } = await supabaseAdmin
        .from("competitive_responses")
        .select("match_id, submitted_at")
        .in("match_id", candidateIds)
        .order("submitted_at", { ascending: false });
      for (const r of (resps ?? []) as Array<{ match_id: string; submitted_at: string }>) {
        if (!lastRespByMatch.has(r.match_id)) lastRespByMatch.set(r.match_id, r.submitted_at);
      }
    }

    let voided = 0;
    let settled = 0;
    let skipped = 0;

    for (const row of (actives ?? []) as CompetitiveMatchRow[]) {
      // Last activity for this match, from the batched map above.
      const lastSubmittedAt = lastRespByMatch.get(row.id) ?? null;
      const hasResponses = !!lastSubmittedAt;
      const lastActivityMs = hasResponses
        ? new Date(lastSubmittedAt).getTime()
        : new Date(row.created_at).getTime();

      const isStale = hasResponses
        ? lastActivityMs < responseCutoffTs
        : row.created_at < createdCutoff;

      if (!isStale) {
        skipped += 1;
        continue;
      }

      // Atomic claim: active → completing. If another path (a live /complete or
      // /forfeit) grabbed it first, skip — it is being settled there.
      const { data: claimed } = await supabaseAdmin
        .from("competitive_matches")
        .update({ status: "completing" })
        .eq("id", row.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();
      if (!claimed) {
        skipped += 1;
        continue;
      }

      const result = await settleClaimedMatch(supabaseAdmin, row);
      if (result.outcome === "voided") voided += 1;
      else settled += 1;
    }

    await putCronHeartbeat("reap-stale-competitive");
    return NextResponse.json({ ok: true, voided, settled, skipped });
  } catch (e) {
    console.error("[cron/reap-stale-competitive]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
