import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { applyFangMultiplier } from "@/lib/mastery-plan";
import { sm2Advance } from "@/lib/vocab";

/**
 * POST /api/vocab/review/[id]
 *
 * Body: { correct: boolean }
 *
 * Advances the SM-2 schedule for the word, increments review_count and
 * correct_count, sets last_reviewed_at, and grants +2 Fangs (multiplier-aware)
 * on a correct answer.
 *
 * Ownership: only the row's owner can submit a review.
 *
 * Response: { word: <updated row>, coinsAwarded: number }
 */

const FANG_PER_CORRECT_REVIEW = 2;

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const wordId = ctx.params.id;
  if (!wordId || typeof wordId !== "string") {
    return NextResponse.json({ error: "Missing word id" }, { status: 400 });
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

  // 1. Load the row (ownership check via user_id eq).
  const { data: row, error: readErr } = await supabaseAdmin
    .from("vocab_words")
    .select("id, user_id, review_count, correct_count, ease_factor")
    .eq("id", wordId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readErr) {
    console.error("[vocab/review GET row]", readErr.message);
    return NextResponse.json({ error: "Couldn't load word" }, { status: 500 });
  }
  if (!row) {
    // 404 vs 403 collapsed — never tell an attacker which.
    return NextResponse.json({ error: "Word not found" }, { status: 404 });
  }

  const nextReviewCount = (row.review_count ?? 0) + 1;
  const nextCorrectCount = (row.correct_count ?? 0) + (correct ? 1 : 0);

  const { easeFactor, nextReviewAt } = sm2Advance({
    correct,
    easeFactor: row.ease_factor ?? 2.5,
    reviewCountAfter: nextReviewCount,
  });

  // 2. Persist. Optimistic concurrency: pin review_count to the value we read
  //    so two parallel reviews can't both move the schedule forward.
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("vocab_words")
    .update({
      review_count: nextReviewCount,
      correct_count: nextCorrectCount,
      ease_factor: easeFactor,
      next_review_at: nextReviewAt,
      last_reviewed_at: new Date().toISOString(),
    })
    .eq("id", wordId)
    .eq("user_id", userId)
    .eq("review_count", row.review_count ?? 0)
    .select("*")
    .maybeSingle();

  if (updateErr) {
    console.error("[vocab/review update]", updateErr.message);
    return NextResponse.json({ error: "Couldn't save review" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Review conflict, try again" },
      { status: 409 },
    );
  }

  // 3. Award +2 Fangs on correct answer (multiplier-aware, cashable).
  let coinsAwarded = 0;
  if (correct) {
    const boosted = await applyFangMultiplier(
      FANG_PER_CORRECT_REVIEW,
      userId,
      supabaseAdmin,
    );
    if (boosted > 0) {
      const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: boosted,
        p_min_balance: 0,
        p_source: "cashable",
      });
      if (creditErr) {
        // Non-fatal: the review still succeeded; we just didn't credit.
        // Log so we can spot upstream balance drift.
        console.error("[vocab/review credit]", creditErr.message);
      } else {
        coinsAwarded = boosted;
        await supabaseAdmin.from("coin_transactions").insert({
          user_id: userId,
          amount: boosted,
          type: "vocab_review",
          reference_id: String(wordId),
          description: "Correct vocab review",
        });
      }
    }
  }

  return NextResponse.json({ word: updated, coinsAwarded });
}
