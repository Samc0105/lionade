// GET /api/cron/reap-pending-deletions — Vercel cron entry point.
//
// Settings overhaul 2026-06-11. DELETE /api/user/account no longer hard-
// deletes inline; it stamps profiles.pending_deletion_at = now + 24h. This
// cron does the deferred hard delete: it scans profiles for any account
// whose grace window has elapsed (pending_deletion_at < now) and removes the
// underlying auth.users row via supabase.auth.admin.deleteUser, which
// cascades through every FK (profiles, friendships, coin_transactions, etc.)
// the schema configured ON DELETE CASCADE.
//
// Runs daily (vercel.json). A user who clicks "Cancel deletion" before the
// window elapses clears pending_deletion_at, so they're skipped here.
//
// Auth is HEADER-ONLY, copied from reap-afk-presence: Vercel sends
// `Authorization: Bearer $CRON_SECRET`; we constant-time compare against
// process.env.CRON_SECRET. No query-string fallback — query strings leak
// into access logs / monitoring / browser history.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/reap-pending-deletions] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Constant-time compare; lengths must match before timingSafeEqual.
  const aBuf = Buffer.from(authHeader);
  const eBuf = Buffer.from(expected);
  if (aBuf.length !== eBuf.length || !timingSafeEqual(aBuf, eBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  // Pull the due accounts. Bounded fetch — a daily cron will never see more
  // than a day's worth of scheduled deletions; the cap is a defensive limit.
  const { data: due, error: selectError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .not("pending_deletion_at", "is", null)
    .lt("pending_deletion_at", nowIso)
    .limit(500);

  if (selectError) {
    console.error("[cron/reap-pending-deletions]", selectError.message);
    return NextResponse.json({ error: "Reap failed" }, { status: 500 });
  }

  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, reaped: 0 });
  }

  let reaped = 0;
  let failed = 0;
  for (const row of due) {
    const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(row.id);
    if (delError) {
      // Log and continue — one stuck row must not block the rest of the batch.
      // It stays scheduled and will be retried on the next run.
      console.error("[cron/reap-pending-deletions] delete", row.id, delError.message);
      failed += 1;
      continue;
    }
    reaped += 1;
  }

  return NextResponse.json({ ok: true, reaped, failed });
}
