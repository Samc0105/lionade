// GET /api/cron/curate-question-bank — Vercel cron entry point.
//
// Turns the question-bank flywheel. Captured questions land with status
// 'pending' (written by /api/ninny/generate), then accumulate times_shown and
// success_rate (from /api/ninny/complete). This daily sweep calls
// runCurationPipeline to promote the good ones to 'approved', reject the
// clearly-wrong ones, and re-tune difficulty from real performance. Before this
// driver existed, the ONLY status-advancer was an admin-only manual route that
// nobody clicked, so captured questions sat 'pending' forever.
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`. Header-only (no
// query-string fallback so secrets never land in logs), constant-time compare,
// fail-closed (500) if the secret is unset, 401 on mismatch. Mirrors the other
// cron routes (expire-grants / academia-digest). runCurationPipeline only
// advances status, so running it twice is harmless.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runCurationPipeline } from "@/lib/question-bank";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/curate-question-bank] CRON_SECRET not configured");
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
    const result = await runCurationPipeline();
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error("[cron/curate-question-bank]", (e as Error).message);
    return NextResponse.json({ error: "Curation failed" }, { status: 500 });
  }
}
