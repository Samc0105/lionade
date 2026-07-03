import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { gradeReview, type WeakSpotRow } from "@/lib/weak-spot-review";
import { logReviewEvent } from "@/lib/review-hub";
import { isMissingSchema } from "@/lib/db/missing-schema";

export const dynamic = "force-dynamic";

// POST /api/ninny/review/grade
// Body: { id: string; selectedIndex?: number; knewIt?: boolean }
//
// Grades ONE weak-spot review attempt and advances its spaced-repetition state.
//
// Server-authoritative grading:
//   - MCQ items: the client sends the chosen option INDEX. The server re-reads
//     the stored correct_answer + reconstructs the option set from the source
//     material and decides correctness itself. The client's own claim of
//     "correct" is NEVER trusted.
//   - Flashcard items (no recoverable option set): the client self-reports via
//     `knewIt`. This is a study aid, not an economy action — NO Fangs are ever
//     granted here, so an honest/dishonest self-report only affects when the
//     item resurfaces for that same user. No incentive to cheat.
//
// On a CORRECT answer we advance the SR schedule (streak+1, miss_count-1) and,
// once mastered, DELETE the row so it stops resurfacing. On WRONG we reset the
// streak and raise miss_count. In both cases last_seen_at is bumped.
//
// Idempotency: the update is keyed on (id, user_id) and is a bounded state
// transition. A retried POST simply re-applies against the current row; because
// no currency is minted and last_seen_at moves forward, a double-submit cannot
// double-grant anything.

const BASE_COLS = "id, user_id, material_id, question_text, correct_answer, miss_count, last_seen_at";
const SR_COLS = `${BASE_COLS}, review_streak, review_interval_days`;
const SM2_COLS = `${SR_COLS}, ease_factor, next_due_at`;

// Which optional-column tier is live? Detected per request by stepping the
// select down on a column error — mirrors lib/review-hub's read tiers.
//   "sm2"     both HELD migrations applied (20260701120000 + 20260702100000)
//   "leitner" only 20260701120000 applied
//   "base"    neither applied
type SrTier = "sm2" | "leitner" | "base";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

interface GradeRequest {
  id?: string;
  selectedIndex?: number;
  knewIt?: boolean;
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: GradeRequest;
  try {
    body = (await req.json()) as GradeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // 1) Read the row (richest optional-column tier first), scoped to the
  //    authed user. A column error steps down a tier; only a base-tier error
  //    is a real failure.
  let row: (WeakSpotRow & { user_id: string }) | null = null;
  let tier: SrTier = "sm2";
  {
    const tiers: { tier: SrTier; cols: string }[] = [
      { tier: "sm2", cols: SM2_COLS },
      { tier: "leitner", cols: SR_COLS },
      { tier: "base", cols: BASE_COLS },
    ];
    for (const t of tiers) {
      const res = await supabaseAdmin
        .from("ninny_wrong_answers")
        .select(t.cols)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (res.error) {
        // Only a MISSING-SCHEMA error (held column migration) steps a tier
        // down. Any other error (network blip, permissions, timeout) used to
        // silently degrade the tier and drop this grade's SM-2 columns from
        // the write — surface it as a real failure instead.
        if (t.tier !== "base" && isMissingSchema(res.error)) {
          continue; // held columns missing — try the next tier down
        }
        console.error("[ninny/review/grade] read:", res.error.message);
        return NextResponse.json({ error: "Failed to read weak spot" }, { status: 500 });
      }
      if (!res.data) {
        return NextResponse.json({ error: "Weak spot not found" }, { status: 404 });
      }
      tier = t.tier;
      row = res.data as unknown as WeakSpotRow & { user_id: string };
      break;
    }
    if (!row) {
      return NextResponse.json({ error: "Weak spot not found" }, { status: 404 });
    }
  }

  // 2) Decide correctness SERVER-SIDE.
  let correct: boolean;

  if (typeof body.selectedIndex === "number" && Number.isInteger(body.selectedIndex)) {
    // MCQ path: reconstruct the option set from the source material and grade
    // the chosen index against the STORED correct_answer. Never trust a
    // client-sent "isCorrect".
    const { data: mat } = await supabaseAdmin
      .from("ninny_materials")
      .select("id, user_id, generated_content")
      .eq("id", row.material_id)
      .eq("user_id", userId)
      .maybeSingle();

    const gc = (mat?.generated_content ?? {}) as {
      multipleChoice?: { question: string; options: string[]; correctIndex: number }[];
      blitz?: { question: string; options: string[]; correctIndex: number }[];
    };
    const banks = [
      ...(Array.isArray(gc.multipleChoice) ? gc.multipleChoice : []),
      ...(Array.isArray(gc.blitz) ? gc.blitz : []),
    ];
    const match = banks.find((q) => norm(q.question) === norm(row.question_text));

    if (match && Array.isArray(match.options) && match.options.length >= 2) {
      const idx = body.selectedIndex;
      if (idx < 0 || idx >= match.options.length) {
        correct = false;
      } else {
        const chosen = match.options[idx];
        // Prefer matching against the stored correct_answer text; fall back to
        // the material's own correctIndex if the text doesn't line up.
        const byText = match.options.findIndex((o) => norm(o) === norm(row.correct_answer));
        const correctIdx = byText >= 0 ? byText : match.correctIndex;
        correct = norm(chosen) === norm(row.correct_answer) || idx === correctIdx;
      }
    } else {
      // Couldn't reconstruct the MCQ (regenerated/absent). This shouldn't happen
      // if the GET served it as an MCQ, but be safe: treat as not gradable and
      // reject so the client can retry as a flashcard.
      return NextResponse.json(
        { error: "Question is no longer gradable as multiple choice" },
        { status: 409 },
      );
    }
  } else if (typeof body.knewIt === "boolean") {
    // Flashcard path: honest self-report (no currency at stake).
    correct = body.knewIt;
  } else {
    return NextResponse.json(
      { error: "Provide selectedIndex (mcq) or knewIt (flashcard)" },
      { status: 400 },
    );
  }

  // 3) Advance the SR schedule (SM-2: ease moves with the grade; at the
  //    default ease this degrades exactly to the old Leitner intervals).
  const outcome = gradeReview(
    {
      miss_count: row.miss_count ?? 1,
      review_streak: row.review_streak ?? 0,
      ease_factor: row.ease_factor ?? undefined,
    },
    correct,
  );

  if (outcome.mastered) {
    // Mastered — remove so it never resurfaces.
    const { error: delErr } = await supabaseAdmin
      .from("ninny_wrong_answers")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (delErr) {
      console.error("[ninny/review/grade] delete:", delErr.message);
      return NextResponse.json({ error: "Failed to update weak spot" }, { status: 500 });
    }
    // Retention log — fail-soft no-op until the HELD review_events table exists.
    await logReviewEvent(userId, "weak_spot", correct);
    return NextResponse.json({
      success: true,
      correct,
      mastered: true,
      newMissCount: 0,
      newReviewStreak: outcome.newReviewStreak,
    });
  }

  // Not mastered — update state. Always safe columns; held columns per tier.
  const update: Record<string, unknown> = {
    miss_count: outcome.newMissCount,
    last_seen_at: outcome.lastSeenAtISO,
  };
  if (tier === "leitner" || tier === "sm2") {
    update.review_streak = outcome.newReviewStreak;
    update.review_interval_days = outcome.nextIntervalDays;
  }
  if (tier === "sm2") {
    update.ease_factor = outcome.newEaseFactor;
    update.next_due_at = outcome.nextDueAtISO;
  }

  const { error: updErr } = await supabaseAdmin
    .from("ninny_wrong_answers")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId);

  if (updErr) {
    console.error("[ninny/review/grade] update:", updErr.message);
    return NextResponse.json({ error: "Failed to update weak spot" }, { status: 500 });
  }

  // Retention log — fail-soft no-op until the HELD review_events table exists.
  await logReviewEvent(userId, "weak_spot", correct);

  return NextResponse.json({
    success: true,
    correct,
    mastered: false,
    newMissCount: outcome.newMissCount,
    newReviewStreak: outcome.newReviewStreak,
  });
}
