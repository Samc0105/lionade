import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * Daily Drill — the "Wordle of studying" daily ritual.
 *
 * GET  /api/daily-drill
 *   Returns up to 5 questions the user got wrong in past Mastery
 *   sessions. Selection is biased toward:
 *     - Older misses (forgotten content first)
 *     - Questions with higher "wrongness" score (missed more often)
 *   Each question carries a `lastWrongAt` timestamp + `subtopicName`
 *   so the UI can show context.
 *
 * POST /api/daily-drill/complete
 *   Idempotent per UTC day. Records the drill completion + grants
 *   Fang reward (5 per correct, +20 streak bonus if all 5 right).
 *
 *   Body: { results: Array<{ questionId: string, wasCorrect: boolean }> }
 *   Response: { coinsEarned, alreadyCompleted, streak }
 *
 * Drill data lives in `daily_drill_completions` — a tiny table that
 * just tracks daily completion + score per user. No question text is
 * stored there (questions live in mastery_questions).
 */

const QUESTIONS_PER_DRILL = 5;
const FANGS_PER_CORRECT = 5;
const FANGS_PERFECT_BONUS = 20;

interface DrillQuestion {
  id: string;
  question: string;
  options: [string, string, string, string];
  difficulty: "easy" | "medium" | "hard";
  subtopicName: string | null;
  classId: string | null;
  className: string | null;
  examTitle: string | null;
  lastWrongAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — fetch today's drill
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const today = new Date().toISOString().slice(0, 10);

  try {
    // Already completed today? Return that state — UI hides the drill
    // card or shows the score.
    const { data: completion } = await supabaseAdmin
      .from("daily_drill_completions")
      .select("score, total, coins_earned, completed_at")
      .eq("user_id", userId)
      .eq("drill_date", today)
      .maybeSingle();

    if (completion) {
      return NextResponse.json({
        completed: true,
        score: completion.score,
        total: completion.total,
        coinsEarned: completion.coins_earned,
        completedAt: completion.completed_at,
        questions: [],
      });
    }

    // Pull every wrong-answer event for this user. Group by question_id,
    // keep the most recent miss + count of misses. Cap to a generous
    // candidate pool (200) before final selection.
    const { data: events } = await supabaseAdmin
      .from("mastery_events")
      .select("question_id, created_at, subtopic_id")
      .eq("user_id", userId)
      .eq("event_type", "answer")
      .eq("was_correct", false)
      .not("question_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!events?.length) {
      return NextResponse.json({
        completed: false,
        questions: [] as DrillQuestion[],
        empty: true,
      });
    }

    type Agg = { questionId: string; subtopicId: string | null; lastWrongAt: string; misses: number };
    const aggregates = new Map<string, Agg>();
    for (const ev of events) {
      const qid = ev.question_id as string;
      const existing = aggregates.get(qid);
      if (existing) {
        existing.misses += 1;
      } else {
        aggregates.set(qid, {
          questionId: qid,
          subtopicId: ev.subtopic_id as string | null,
          lastWrongAt: ev.created_at,
          misses: 1,
        });
      }
    }

    // Score each candidate: more misses = higher priority; older misses
    // = higher priority (forgetting curve).
    const now = Date.now();
    const scored = Array.from(aggregates.values()).map(a => {
      const ageDays = Math.max(0, (now - new Date(a.lastWrongAt).getTime()) / 86_400_000);
      const ageBoost = Math.min(1, ageDays / 14); // saturates at 14 days
      const score = a.misses * 0.6 + ageBoost * 0.4 + Math.random() * 0.05;
      return { ...a, score };
    });
    scored.sort((a, b) => b.score - a.score);

    // Take the top N candidates we'll likely keep, plus a few extras in
    // case some lookups fail.
    const topIds = scored.slice(0, QUESTIONS_PER_DRILL * 2).map(s => s.questionId);
    if (topIds.length === 0) {
      return NextResponse.json({ completed: false, questions: [], empty: true });
    }

    // Fetch question text + options + subtopic context.
    const [qRes, subRes] = await Promise.all([
      supabaseAdmin
        .from("mastery_questions")
        .select("id, content_hash, question, options, correct_index, difficulty")
        .in("id", topIds)
        .eq("status", "approved"),
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, name, content_hash, user_exam_id")
        .in("id", scored.slice(0, QUESTIONS_PER_DRILL * 2)
          .map(s => s.subtopicId)
          .filter((x): x is string => !!x)),
    ]);

    const questionRows = qRes.data ?? [];
    const subRows = subRes.data ?? [];

    // Map subtopic → exam → class for context
    const subById = new Map(subRows.map(s => [s.id, s]));
    const examIds = Array.from(new Set(subRows.map(s => s.user_exam_id).filter(Boolean))) as string[];
    const examMap = new Map<string, { id: string; title: string; class_id: string | null }>();
    if (examIds.length > 0) {
      const { data: exams } = await supabaseAdmin
        .from("user_exams")
        .select("id, title, class_id")
        .in("id", examIds);
      for (const e of exams ?? []) examMap.set(e.id, e);
    }
    const classIds = Array.from(new Set(Array.from(examMap.values()).map(e => e.class_id).filter(Boolean))) as string[];
    const classMap = new Map<string, { id: string; name: string }>();
    if (classIds.length > 0) {
      const { data: cls } = await supabaseAdmin
        .from("classes")
        .select("id, name")
        .in("id", classIds);
      for (const c of cls ?? []) classMap.set(c.id, c);
    }

    // Build the response in the original ranking order.
    const out: DrillQuestion[] = [];
    for (const cand of scored) {
      if (out.length >= QUESTIONS_PER_DRILL) break;
      const q = questionRows.find(qr => qr.id === cand.questionId);
      if (!q) continue;
      const sub = cand.subtopicId ? subById.get(cand.subtopicId) : null;
      const exam = sub ? examMap.get(sub.user_exam_id) : null;
      const cls = exam?.class_id ? classMap.get(exam.class_id) : null;

      const opts = Array.isArray(q.options) ? q.options : [];
      out.push({
        id: q.id,
        question: q.question,
        options: [opts[0], opts[1], opts[2], opts[3]].map(o => String(o ?? "")) as [string, string, string, string],
        difficulty: (["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium") as "easy" | "medium" | "hard",
        subtopicName: sub?.name ?? null,
        classId: cls?.id ?? null,
        className: cls?.name ?? null,
        examTitle: exam?.title ?? null,
        lastWrongAt: cand.lastWrongAt,
      });
    }

    return NextResponse.json({
      completed: false,
      questions: out,
      empty: out.length === 0,
    });
  } catch (e) {
    console.error("[daily-drill GET]", e);
    return NextResponse.json({ error: "Couldn't load Daily Drill." }, { status: 500 });
  }
}
