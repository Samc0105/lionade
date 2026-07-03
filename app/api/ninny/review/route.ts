import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchWeakSpotQueue } from "@/lib/review-hub";

export const dynamic = "force-dynamic";

// GET /api/ninny/review?limit=15
//
// Returns the authed user's DUE weak-spot questions (spaced-repetition), newest
// misses ordered most-urgent-first, reconstructed into real MCQs where the
// original option set can be recovered from the source material, otherwise as
// flashcard-reveal items.
//
// The heavy lifting (tiered SR-column detection, due filter, priority order,
// MCQ reconstruction) lives in lib/review-hub.ts `fetchWeakSpotQueue`, shared
// with the unified Review Hub queue at GET /api/review/queue. This route keeps
// its original response shape for existing callers.
//
// Server-authoritative: reads via supabaseAdmin, scoped to auth.userId. The
// client never sends a user id.
//
// Fail-soft: SR columns are optional across TWO held migrations —
// 20260701120000 (review_streak / review_interval_days, Leitner) and
// 20260702100000 (ease_factor / next_due_at, SM-2). The fetcher tries the
// richest select first and steps down tiers on a column error. On a hard read
// failure it returns the empty caught-up state instead of 500ing.

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 40;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT),
  );

  const queue = await fetchWeakSpotQueue(userId, limit);

  return NextResponse.json({
    items: queue.items,
    dueCount: queue.dueCount,
    totalWeakSpots: queue.totalWeakSpots,
    nextDueInMs: queue.nextDueInMs,
  });
}
