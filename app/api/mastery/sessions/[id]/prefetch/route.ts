import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { pickNextSubtopic, pickDifficulty } from "@/lib/mastery";
import { getOrGenerateQuestion } from "@/lib/mastery-content";

/**
 * POST /api/mastery/sessions/[id]/prefetch
 *
 * Returns a batch of "warm" questions the client can stage in its queue for
 * instant delivery on the next turn. This endpoint DOES NOT mutate the
 * session's pending state — it just walks the question bank (and generates
 * on cache miss) for likely upcoming subtopics and hands back the data.
 *
 * Strategy:
 *   - "reinforce" → stay on `lastSubtopicId` (user just got it wrong; drill
 *                   the same weakness before moving on).
 *   - "next"      → pick the next weakest-weighted subtopic other than the
 *                   last one (user got it right; keep variety).
 *
 * Answer validation still flows through `/next` + `/answer`. The client
 * submits a `preferredQuestionId` to /next, which turns the queued question
 * into the live pending one.
 *
 * Body: {
 *   count?: number,                 // default 5, max 8
 *   strategy?: "next" | "reinforce",
 *   lastSubtopicId?: string,        // anchor for reinforce
 *   avoidIds?: string[],            // questions already in the client queue
 * }
 *
 * Response: {
 *   questions: Array<{
 *     questionId, subtopicId, subtopicName,
 *     question, options[4], difficulty,
 *   }>
 * }
 */

const MAX_COUNT = 8;
const DEFAULT_COUNT = 5;

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  let body: {
    count?: number;
    strategy?: "next" | "reinforce";
    lastSubtopicId?: string;
    avoidIds?: string[];
  } = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  const count = Math.max(1, Math.min(MAX_COUNT, Number(body.count) || DEFAULT_COUNT));
  const strategy = body.strategy === "reinforce" ? "reinforce" : "next";
  const avoidIds = Array.isArray(body.avoidIds) ? body.avoidIds.slice(0, 50).map(String) : [];

  try {
    // Validate session ownership
    const { data: session } = await supabaseAdmin
      .from("mastery_sessions")
      .select("id, user_id, user_exam_id, status")
      .eq("id", sessionId)
      .single();

    if (!session || session.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (session.status !== "active") {
      return NextResponse.json({ questions: [] });
    }

    // Load exam + subtopics + progress to decide which subtopics to pre-fetch
    const [examRes, subRes, progRes, seenRes] = await Promise.all([
      supabaseAdmin
        .from("user_exams")
        .select("id, title, mastery_bkt_target")
        .eq("id", session.user_exam_id)
        .single(),
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, name, weight, display_order, content_hash")
        .eq("user_exam_id", session.user_exam_id)
        .order("display_order"),
      supabaseAdmin
        .from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts, last_seen_at")
        .eq("user_id", userId),
      supabaseAdmin
        .from("mastery_events")
        .select("question_id")
        .eq("session_id", sessionId)
        .not("question_id", "is", null),
    ]);

    const exam = examRes.data;
    if (!exam) return NextResponse.json({ questions: [] });

    const subs = subRes.data ?? [];
    if (!subs.length) return NextResponse.json({ questions: [] });

    const progMap = new Map((progRes.data ?? []).map(p => [p.subtopic_id, p]));
    const seenQuestionIds = new Set<string>([
      ...((seenRes.data ?? []).map(e => e.question_id as string).filter(Boolean)),
      ...avoidIds,
    ]);

    // Build the target-subtopic sequence for this prefetch. Each subsequent
    // pick should be different from the previous one so we don't serve 5
    // questions from the same subtopic (unless strategy=reinforce).
    const targets: string[] = [];

    if (strategy === "reinforce" && body.lastSubtopicId && subs.some(s => s.id === body.lastSubtopicId)) {
      // Stay on the weak subtopic for the full batch (user got last one wrong)
      for (let i = 0; i < count; i++) targets.push(body.lastSubtopicId);
    } else {
      // Rotate through weakest-weighted subtopics, skipping last one for variety
      const excludeId = strategy === "next" ? body.lastSubtopicId : undefined;
      for (let i = 0; i < count; i++) {
        const scored = subs
          .filter(s => excludeId ? s.id !== excludeId : true)
          .map(s => {
            const p = progMap.get(s.id);
            return {
              subtopicId: s.id,
              weight: s.weight,
              pMastery: p?.p_mastery ?? 0.10,
              lastSeenAt: p?.last_seen_at ? new Date(p.last_seen_at).getTime() : null,
            };
          });
        // Bias by how many we've already picked for this subtopic in THIS batch
        const countsInBatch = targets.reduce<Record<string, number>>((acc, id) => {
          acc[id] = (acc[id] ?? 0) + 1;
          return acc;
        }, {});
        const biased = scored.map(s => ({
          ...s,
          pMastery: s.pMastery + (countsInBatch[s.subtopicId] ?? 0) * 0.15, // push repeats down
        }));
        const next = pickNextSubtopic(biased);
        if (!next) break;
        targets.push(next);
      }
    }

    // Generate / cache-lookup each target sequentially. Parallelizing would
    // be fine on cache hits but risks many Sonnet calls in flight on misses;
    // 5 sequential lookups feels fast enough.
    const out: Array<{
      questionId: string; subtopicId: string; subtopicName: string;
      question: string; options: string[]; difficulty: string;
    }> = [];

    for (const subtopicId of targets) {
      const sub = subs.find(s => s.id === subtopicId);
      if (!sub) continue;
      const p = progMap.get(subtopicId);
      const difficulty = pickDifficulty(p?.p_mastery ?? 0.10);

      const { question } = await getOrGenerateQuestion({
        examTitle: exam.title,
        subtopicName: sub.name,
        contentHash: sub.content_hash,
        difficulty,
        avoidIds: Array.from(seenQuestionIds),
        userIdForTelemetry: userId,
      });
      if (!question) continue;
      if (seenQuestionIds.has(question.id)) continue;

      seenQuestionIds.add(question.id);
      out.push({
        questionId: question.id,
        subtopicId,
        subtopicName: sub.name,
        question: question.question,
        options: question.options,
        difficulty: question.difficulty,
      });
    }

    return NextResponse.json({ questions: out });
  } catch (e) {
    console.error("[mastery/sessions/:id/prefetch]", e);
    return NextResponse.json({ questions: [] });
  }
}
