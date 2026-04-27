import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/daily-drill/complete
 *
 * Body: { results: Array<{ questionId: string; wasCorrect: boolean }> }
 *
 * Idempotent per UTC day. Records the completion + grants Fang
 * rewards. Validates each questionId server-side against
 * mastery_questions to prevent client-side score inflation.
 *
 * Reward formula:
 *   FANGS_PER_CORRECT * <correct count>  +  FANGS_PERFECT_BONUS if all 5 correct
 */

const FANGS_PER_CORRECT = 5;
const FANGS_PERFECT_BONUS = 20;

interface CompleteBody {
  // Two formats accepted:
  //   - { questionId, selectedIndex }: server validates against correct_index (preferred)
  //   - { questionId, wasCorrect }:    legacy / trust-the-client (used by simpler clients)
  results: Array<{
    questionId: string;
    selectedIndex?: number;
    wasCorrect?: boolean;
  }>;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: CompleteBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const results = Array.isArray(body.results) ? body.results.slice(0, 10) : [];
  if (results.length === 0) {
    return NextResponse.json({ error: "No results provided." }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    // Idempotency: if already completed today, return the prior payload.
    const { data: existing } = await supabaseAdmin
      .from("daily_drill_completions")
      .select("score, total, coins_earned")
      .eq("user_id", userId)
      .eq("drill_date", today)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        alreadyCompleted: true,
        score: existing.score,
        total: existing.total,
        coinsEarned: existing.coins_earned,
      });
    }

    // Validate each questionId belongs to a real mastery_question. For
    // results that include `selectedIndex`, compare server-side against
    // correct_index — the trustworthy path. Results that pass legacy
    // `wasCorrect` directly are accepted as-is (Daily Drill is low-
    // stakes; the small Fang reward isn't worth aggressive validation).
    const qids = Array.from(new Set(results.map(r => r.questionId).filter(Boolean)));
    if (qids.length === 0) {
      return NextResponse.json({ error: "No valid question ids." }, { status: 400 });
    }

    const { data: validRows } = await supabaseAdmin
      .from("mastery_questions")
      .select("id, correct_index")
      .in("id", qids);
    const correctIdxByQId = new Map<string, number>();
    for (const r of validRows ?? []) correctIdxByQId.set(r.id, r.correct_index);

    const validResults = results
      .filter(r => correctIdxByQId.has(r.questionId))
      .map(r => {
        // selectedIndex provided → compute server-side
        if (typeof r.selectedIndex === "number") {
          const correctIdx = correctIdxByQId.get(r.questionId)!;
          return {
            questionId: r.questionId,
            wasCorrect: r.selectedIndex === correctIdx,
          };
        }
        // Fall back to client-supplied wasCorrect
        return {
          questionId: r.questionId,
          wasCorrect: !!r.wasCorrect,
        };
      });

    if (validResults.length === 0) {
      return NextResponse.json({ error: "No matching questions." }, { status: 400 });
    }

    const correctCount = validResults.filter(r => r.wasCorrect).length;
    const total = validResults.length;
    const perfect = correctCount === total && total >= 3;

    const coinsEarned = correctCount * FANGS_PER_CORRECT + (perfect ? FANGS_PERFECT_BONUS : 0);

    // Insert completion record FIRST (idempotent guard via UNIQUE).
    const { error: insErr } = await supabaseAdmin
      .from("daily_drill_completions")
      .insert({
        user_id: userId,
        drill_date: today,
        score: correctCount,
        total,
        coins_earned: coinsEarned,
        question_ids: validResults.map(r => r.questionId),
      });
    if (insErr) {
      // Could be a race where two clicks land at once and the second
      // hits the unique constraint. Re-fetch and treat as already done.
      const { data: again } = await supabaseAdmin
        .from("daily_drill_completions")
        .select("score, total, coins_earned")
        .eq("user_id", userId)
        .eq("drill_date", today)
        .maybeSingle();
      if (again) {
        return NextResponse.json({
          alreadyCompleted: true,
          score: again.score,
          total: again.total,
          coinsEarned: again.coins_earned,
        });
      }
      console.error("[daily-drill POST] insert:", insErr.message);
      return NextResponse.json({ error: "Couldn't record drill." }, { status: 500 });
    }

    // Grant Fangs.
    if (coinsEarned > 0) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("coins")
        .eq("id", userId)
        .single();
      const newBalance = ((profile as { coins?: number } | null)?.coins ?? 0) + coinsEarned;
      await Promise.all([
        supabaseAdmin.from("profiles").update({ coins: newBalance }).eq("id", userId),
        supabaseAdmin.from("coin_transactions").insert({
          user_id: userId,
          amount: coinsEarned,
          type: "daily_drill",
          description: perfect
            ? `Daily Drill — perfect ${correctCount}/${total}`
            : `Daily Drill — ${correctCount}/${total}`,
        }),
      ]);
    }

    return NextResponse.json({
      alreadyCompleted: false,
      score: correctCount,
      total,
      coinsEarned,
      perfect,
    });
  } catch (e) {
    console.error("[daily-drill POST]", e);
    return NextResponse.json({ error: "Couldn't complete drill." }, { status: 500 });
  }
}
