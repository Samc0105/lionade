// GET /api/cron/reap-afk-presence — Vercel cron entry point.
//
// Called every 60 seconds by the schedule in `vercel.json`. Vercel sends
// the cron secret as `Authorization: Bearer $CRON_SECRET`; we reject
// anything that doesn't match `process.env.CRON_SECRET` so this can't be
// invoked by anyone else.
//
// Auth is HEADER-ONLY (no query-string fallback). Query strings end up in
// access logs, monitoring dashboards, and browser histories; the secret
// must never appear there. Constant-time compare prevents timing attacks
// against the secret length.
//
// The RPC `reap_afk_presence()` does the actual work: it scans the
// `presence_heartbeats` table for rows whose `last_ping_at` is older than
// the configured TTL (currently 60s in the migration) and clears the
// owning user's `profiles.active_session`. Returns the number of rows
// reaped so we can log + chart.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/reap-afk-presence] CRON_SECRET not configured");
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

  try {
    const { data, error } = await supabaseAdmin.rpc("reap_afk_presence");
    if (error) {
      console.error("[cron/reap-afk-presence]", error.message);
      return NextResponse.json({ error: "Reap failed" }, { status: 500 });
    }
    // RPC returns the number of rows reaped (int). Defensive coalesce.
    const reaped = typeof data === "number" ? data : 0;
    return NextResponse.json({ ok: true, reaped });
  } catch (e) {
    console.error("[cron/reap-afk-presence] unexpected", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
