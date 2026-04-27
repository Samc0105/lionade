import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { callAIForJson, LLM_CHEAP } from "@/lib/ai";
import { displayPct } from "@/lib/mastery";

/**
 * GET /api/classes/[id]/plan
 *
 * Returns today's AI-generated study plan for this class. Cached in
 * `class_daily_plans` keyed by (user, class, date) so reloading the
 * dashboard doesn't burn an OpenAI call.
 *
 * Inputs the AI sees:
 *   - Class name, code, term
 *   - Days until next exam in this class (if set)
 *   - Per-subtopic mastery snapshot from attached user_exams
 *   - Up to 5 recent note titles + summaries
 *   - User's daily_target minutes from profile
 *
 * Output is structured JSON: a list of tasks with kind/label/minutes/
 * deepLink so the UI can render action buttons.
 *
 * Pass `?regenerate=1` to force a fresh plan (for testing or after a
 * big mastery shift).
 */

type RouteCtx = { params: { id: string } };

interface PlanTask {
  kind: "mastery" | "review_notes" | "quiz" | "break";
  label: string;
  minutes: number;
  deepLink: string | null;
  /** Optional one-line "why this task" — surfaced in tooltip / expanded view */
  why?: string;
}

interface PlanShape {
  tasks: PlanTask[];
  totalMinutes: number;
  summary: string;
  generatedAt: string;
  fromCache: boolean;
}

const DEFAULT_DAILY_TARGET_MINUTES = 30;

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  const forceRegen = req.nextUrl.searchParams.get("regenerate") === "1";
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Ownership check
    const { data: cls } = await supabaseAdmin
      .from("classes")
      .select("id, user_id, name, short_code, term, color, archived")
      .eq("id", classId)
      .single();
    if (!cls || cls.user_id !== userId || cls.archived) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Cache check
    if (!forceRegen) {
      const { data: cached } = await supabaseAdmin
        .from("class_daily_plans")
        .select("plan, generated_at")
        .eq("user_id", userId)
        .eq("class_id", classId)
        .eq("plan_date", today)
        .maybeSingle();
      if (cached) {
        const cachedPlan = cached.plan as Omit<PlanShape, "generatedAt" | "fromCache">;
        return NextResponse.json({
          plan: { ...cachedPlan, generatedAt: cached.generated_at, fromCache: true },
        });
      }
    }

    // ── Build context for the AI ──────────────────────────────────────────
    const [examsRes, profileRes, notesRes] = await Promise.all([
      supabaseAdmin
        .from("user_exams")
        .select("id, title, target_date, mastery_bkt_target")
        .eq("user_id", userId)
        .eq("class_id", classId)
        .eq("archived", false),
      supabaseAdmin
        .from("profiles")
        .select("daily_target")
        .eq("id", userId)
        .single(),
      supabaseAdmin
        .from("class_notes")
        .select("title, ai_summary, ai_topics, body, updated_at")
        .eq("user_id", userId)
        .eq("class_id", classId)
        .eq("archived", false)
        .order("updated_at", { ascending: false })
        .limit(5),
    ]);

    const exams = examsRes.data ?? [];
    const dailyTargetMinutes = (profileRes.data?.daily_target as number | null) || DEFAULT_DAILY_TARGET_MINUTES;
    const notes = notesRes.data ?? [];

    // Per-subtopic mastery snapshot for each exam
    type SubtopicSnap = {
      examId: string;
      examTitle: string;
      subtopicName: string;
      displayPct: number;
      attempts: number;
    };
    const snaps: SubtopicSnap[] = [];
    if (exams.length) {
      const examIds = exams.map(e => e.id);
      const [subsRes, progRes] = await Promise.all([
        supabaseAdmin
          .from("mastery_subtopics")
          .select("id, user_exam_id, name, display_order, weight")
          .in("user_exam_id", examIds)
          .order("display_order"),
        supabaseAdmin
          .from("mastery_progress")
          .select("subtopic_id, p_mastery, attempts")
          .eq("user_id", userId),
      ]);
      const progMap = new Map((progRes.data ?? []).map(p => [p.subtopic_id, p]));
      for (const sub of subsRes.data ?? []) {
        const p = progMap.get(sub.id);
        const exam = exams.find(e => e.id === sub.user_exam_id);
        if (!exam) continue;
        snaps.push({
          examId: exam.id,
          examTitle: exam.title,
          subtopicName: sub.name,
          displayPct: p ? displayPct(p.p_mastery, p.attempts, exam.mastery_bkt_target) : 0,
          attempts: p?.attempts ?? 0,
        });
      }
    }

    // Days until soonest upcoming exam
    let daysUntilExam: number | null = null;
    let nextExamTitle: string | null = null;
    {
      const todayMs = new Date(today + "T00:00:00").getTime();
      const upcoming = exams
        .filter(e => e.target_date && new Date(e.target_date + "T00:00:00").getTime() >= todayMs)
        .sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""));
      if (upcoming.length > 0) {
        const ms = new Date(upcoming[0].target_date + "T00:00:00").getTime() - todayMs;
        daysUntilExam = Math.ceil(ms / 86_400_000);
        nextExamTitle = upcoming[0].title;
      }
    }

    // ── Build prompt ──────────────────────────────────────────────────────
    const subtopicsLines = snaps.length
      ? snaps
          .sort((a, b) => a.displayPct - b.displayPct)
          .slice(0, 12)
          .map(s => `  - "${s.subtopicName}" (${s.examTitle}): ${Math.round(s.displayPct)}% mastered, ${s.attempts} attempts`)
          .join("\n")
      : "  (none yet — user hasn't created exam targets in this class)";

    const notesLines = notes.length
      ? notes.slice(0, 5).map(n => `  - ${n.title || (n.ai_summary || n.body.slice(0, 80))}${n.ai_topics?.length ? ` [${n.ai_topics.join(", ")}]` : ""}`).join("\n")
      : "  (no notes yet)";

    const examLine = nextExamTitle && daysUntilExam !== null
      ? `Next exam: "${nextExamTitle}" in ${daysUntilExam} day${daysUntilExam === 1 ? "" : "s"}.`
      : "No exam date set yet for this class.";

    const { json: planJson, raw } = await callAIForJson<{
      tasks: Array<{
        kind?: string;
        label?: string;
        minutes?: number;
        examId?: string | null;
        why?: string;
      }>;
      summary?: string;
    }>({
      model: LLM_CHEAP,
      maxTokens: 700,
      temperature: 0.4,
      timeoutMs: 18_000,
      system:
        "You are Ninny, a study coach. Generate a focused, achievable daily plan for ONE class. Tasks must be concrete, scoped to today, and add up to roughly the user's daily target. Return ONLY a single JSON object.",
      userContent:
`Class: ${cls.name}${cls.short_code ? ` (${cls.short_code})` : ""}${cls.term ? ` · ${cls.term}` : ""}
${examLine}
Daily target: ~${dailyTargetMinutes} minutes.

Subtopic mastery (lowest first):
${subtopicsLines}

Recent notes from this class:
${notesLines}

Today's date: ${today}

Generate 2-4 tasks for today. Use these task kinds:
  - "mastery"      → drill mastery on a weak subtopic (link to a specific examId)
  - "review_notes" → re-read recent notes for retention
  - "quiz"         → quick generic quiz on a topic
  - "break"        → optional 5-min mental break (only include if total minutes is high)

Each task:
  - "label": punchy, second-person, <= 70 chars (e.g. "Drill IAM policy boundaries")
  - "minutes": realistic chunk (5-25 typical, max 45)
  - "examId": uuid of the user_exam this task targets (only for "mastery" or "quiz" kinds; null otherwise)
  - "why": one short sentence explaining why this task NOW (<= 110 chars)

Total minutes should land within ±25% of the daily target.
Prioritize the lowest-mastery subtopics. If exam is within 7 days, push hard on weak topics.

Return EXACTLY:
{
  "tasks": [
    { "kind": "...", "label": "...", "minutes": 0, "examId": "uuid|null", "why": "..." }
  ],
  "summary": "<one-line motivation, <= 100 chars>"
}`,
    });

    // Validate + map AI output to our PlanTask shape with proper deepLinks
    const allowedKinds = new Set(["mastery", "review_notes", "quiz", "break"]);
    const examIds = new Set(exams.map(e => e.id));

    const tasks: PlanTask[] = (Array.isArray(planJson.tasks) ? planJson.tasks : [])
      .map((t): PlanTask | null => {
        const kind = (allowedKinds.has(String(t.kind)) ? t.kind : "mastery") as PlanTask["kind"];
        const label = String(t.label ?? "").slice(0, 100).trim();
        if (!label) return null;
        const minutes = Math.max(1, Math.min(60, Math.floor(Number(t.minutes) || 10)));
        const why = t.why ? String(t.why).slice(0, 140).trim() : undefined;

        // Build deepLink based on kind
        let deepLink: string | null = null;
        if (kind === "mastery" && t.examId && examIds.has(t.examId)) {
          deepLink = `/learn/mastery/${t.examId}`;
        } else if (kind === "quiz" && t.examId && examIds.has(t.examId)) {
          deepLink = `/learn/mastery/${t.examId}`;
        } else if (kind === "review_notes") {
          deepLink = `/classes/${classId}#notes`;
        }

        return { kind, label, minutes, deepLink, why };
      })
      .filter((t): t is PlanTask => t !== null)
      .slice(0, 5);

    if (tasks.length === 0) {
      // AI failed to produce usable tasks — fallback to a simple stub.
      tasks.push({
        kind: "mastery",
        label: exams.length > 0 ? `Open ${exams[0].title}` : `Set up an exam target for this class`,
        minutes: dailyTargetMinutes,
        deepLink: exams.length > 0 ? `/learn/mastery/${exams[0].id}` : `/learn/mastery?classId=${classId}`,
      });
    }

    const totalMinutes = tasks.reduce((a, t) => a + t.minutes, 0);
    const summary = String(planJson.summary ?? "").slice(0, 140).trim() || "Today's grind, mapped out.";

    const planPayload = { tasks, totalMinutes, summary };

    // Cache the plan (best-effort — even if upsert fails, return the plan)
    void supabaseAdmin
      .from("class_daily_plans")
      .upsert({
        user_id: userId,
        class_id: classId,
        plan_date: today,
        plan: planPayload,
        ai_model: LLM_CHEAP,
        ai_cost_micro_usd: raw.costMicroUsd,
      }, { onConflict: "user_id,class_id,plan_date" });

    const generatedAt = new Date().toISOString();
    return NextResponse.json({
      plan: { ...planPayload, generatedAt, fromCache: false },
    });
  } catch (e) {
    console.error("[classes/:id/plan]", e);
    return NextResponse.json({ error: "Couldn't generate today's plan." }, { status: 500 });
  }
}
