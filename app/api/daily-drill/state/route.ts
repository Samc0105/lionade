import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * /api/daily-drill/state — per-day progress autosave.
 *
 * Each Daily Drill is 5 questions; if the user closes the tab mid-drill we'd
 * normally lose progress and they'd start over tomorrow. This route persists
 * the answered question-ids + running correct_count to `daily_drill_progress`
 * so a refresh resumes from the next unanswered question.
 *
 * GET  → return today's row (or null). Used on drill mount.
 * POST → append a question-id to `answered_question_ids` and (optionally)
 *        increment `correct_count`. Idempotent on repeated question-ids: we
 *        union into the existing array so a duplicate POST doesn't double-count.
 *
 * Drill completion (5/5) is handled by `/api/daily-drill/complete` and is
 * unaffected by this route. The row stays as a permanent record of the day's
 * answer set; only `partial_answer` would ever be cleared (n/a for daily drill
 * since drill is MCQ — no free-text input).
 *
 * Rate-limited to 30/min in middleware (`daily-drill-state` bucket).
 *
 * Schema (Phase 1):
 *   daily_drill_progress (
 *     user_id uuid,
 *     drill_date date,
 *     answered_question_ids uuid[],
 *     correct_count int default 0,
 *     partial_answer text,
 *     last_active_at timestamptz default now(),
 *     PRIMARY KEY (user_id, drill_date)
 *   )
 *
 * Phase 2 — Tier 3 refresh-resumable state. Web ships; iOS port should mirror
 * via AsyncStorage cache. See IOS_PARITY.md row 2026-06-04.
 */

interface DrillStateBody {
  questionId?: string;
  wasCorrect?: boolean;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const today = todayUtc();

  try {
    const { data, error } = await supabaseAdmin
      .from("daily_drill_progress")
      .select("user_id, drill_date, answered_question_ids, correct_count, partial_answer, last_active_at")
      .eq("user_id", userId)
      .eq("drill_date", today)
      .maybeSingle();
    if (error) {
      console.warn("[daily-drill/state GET]", error.message);
      return NextResponse.json({ state: null });
    }
    if (!data) return NextResponse.json({ state: null });
    return NextResponse.json({
      state: {
        drillDate: data.drill_date,
        answeredQuestionIds: data.answered_question_ids ?? [],
        correctCount: data.correct_count ?? 0,
        partialAnswer: data.partial_answer,
        lastActiveAt: data.last_active_at,
      },
    });
  } catch (e) {
    console.error("[daily-drill/state GET]", e);
    return NextResponse.json({ state: null });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const today = todayUtc();

  let body: DrillStateBody;
  try { body = (await req.json()) as DrillStateBody; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const questionId = typeof body.questionId === "string" && body.questionId.length > 0
    ? body.questionId
    : null;
  if (!questionId) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }
  const wasCorrect = !!body.wasCorrect;

  try {
    // Pull existing row first so we can union the question-id (idempotent on
    // duplicate POSTs) and clamp correct_count to existing+1.
    const { data: existing } = await supabaseAdmin
      .from("daily_drill_progress")
      .select("answered_question_ids, correct_count")
      .eq("user_id", userId)
      .eq("drill_date", today)
      .maybeSingle();

    const priorIds: string[] = Array.isArray(existing?.answered_question_ids)
      ? (existing!.answered_question_ids as string[])
      : [];
    const alreadyAnswered = priorIds.includes(questionId);
    const nextIds = alreadyAnswered ? priorIds : [...priorIds, questionId];
    const priorCorrect = Number(existing?.correct_count ?? 0);
    const nextCorrect = alreadyAnswered
      ? priorCorrect
      : priorCorrect + (wasCorrect ? 1 : 0);

    const { error } = await supabaseAdmin
      .from("daily_drill_progress")
      .upsert(
        {
          user_id: userId,
          drill_date: today,
          answered_question_ids: nextIds,
          correct_count: nextCorrect,
          last_active_at: new Date().toISOString(),
        },
        { onConflict: "user_id,drill_date" },
      );
    if (error) {
      console.error("[daily-drill/state POST]", error.message);
      return NextResponse.json({ error: "Couldn't save progress" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      answeredQuestionIds: nextIds,
      correctCount: nextCorrect,
    });
  } catch (e) {
    console.error("[daily-drill/state POST]", e);
    return NextResponse.json({ error: "Couldn't save progress" }, { status: 500 });
  }
}
