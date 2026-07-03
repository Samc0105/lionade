import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sm2Advance } from "@/lib/vocab";
import { isMissingSchema, logReviewEvent } from "@/lib/review-hub";
import { isUuid, STUDY_SETS_NOT_READY_MSG } from "@/lib/study-sets";

export const dynamic = "force-dynamic";

/**
 * POST /api/study-sets/cards/[cardId]/review
 *
 * Body: { correct: boolean }
 *
 * Advances the card's SM-2 schedule using lib/vocab.ts semantics mapped onto
 * the study_cards columns (ease / interval_days / next_due_at / review_count /
 * correct_count), then logs a fire-and-forget review_events row with source
 * "study_set".
 *
 * REWARD-FREE v1 (weak-spot precedent): self-graded reviews cannot be gamed
 * for Fangs because they award none. No ledger writes anywhere in this route.
 *
 * Ownership: only the card's owner can grade it. Optimistic concurrency pins
 * review_count so two parallel grades can't both advance the schedule.
 */

type RouteCtx = { params: { cardId: string } };

const DAY_MS = 86_400_000;

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!isUuid(params.cardId)) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { correct } = (body ?? {}) as { correct?: unknown };
  if (typeof correct !== "boolean") {
    return NextResponse.json(
      { error: "Body must include { correct: boolean }" },
      { status: 400 },
    );
  }

  // 1) Load the row (ownership check via user_id eq).
  const { data: row, error: readErr } = await supabaseAdmin
    .from("study_cards")
    .select("id, user_id, set_id, ease, review_count, correct_count")
    .eq("id", params.cardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readErr) {
    if (isMissingSchema(readErr)) {
      return NextResponse.json(
        { error: STUDY_SETS_NOT_READY_MSG, notReady: true },
        { status: 503 },
      );
    }
    console.error("[study-sets/review load]", readErr.message);
    return NextResponse.json({ error: "Couldn't load the card." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const nextReviewCount = (row.review_count ?? 0) + 1;
  const nextCorrectCount = (row.correct_count ?? 0) + (correct ? 1 : 0);

  // lib/vocab.ts SM-2: correct -> ease +0.1, interval ease^reviewCount days;
  // wrong -> ease -0.2, retry in 10 minutes. interval_days is derived from the
  // returned timestamp so the column mirrors the actual schedule.
  const { easeFactor, nextReviewAt } = sm2Advance({
    correct,
    easeFactor: Number(row.ease ?? 2.5),
    reviewCountAfter: nextReviewCount,
  });
  const intervalDays =
    Math.round(
      Math.max(0, (new Date(nextReviewAt).getTime() - Date.now()) / DAY_MS) * 10_000,
    ) / 10_000;

  // 2) Persist. Optimistic concurrency: pin review_count to the value we read.
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("study_cards")
    .update({
      ease: easeFactor,
      interval_days: intervalDays,
      next_due_at: nextReviewAt,
      review_count: nextReviewCount,
      correct_count: nextCorrectCount,
    })
    .eq("id", params.cardId)
    .eq("user_id", userId)
    .eq("review_count", row.review_count ?? 0)
    .select(
      "id, type, front, back, options, correct_index, ease, interval_days, next_due_at, review_count, correct_count",
    )
    .maybeSingle();

  if (updateErr) {
    console.error("[study-sets/review update]", updateErr.message);
    return NextResponse.json({ error: "Couldn't save the review." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Review conflict, try again" },
      { status: 409 },
    );
  }

  // Retention log for the Review Hub stat — fire-and-forget semantics, never
  // throws, silently no-ops until the HELD review_events table is applied.
  await logReviewEvent(userId, "study_set", correct);

  return NextResponse.json({ card: updated, coinsAwarded: 0 });
}
