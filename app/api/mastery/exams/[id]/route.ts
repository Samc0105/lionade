import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { displayPct, pPass, isPassReady, isMasteryReached } from "@/lib/mastery";

/**
 * GET /api/mastery/exams/[id]
 *
 * Full exam detail for the Mastery Mode dashboard: title, every subtopic
 * with its weight + mastery snapshot, overall pPass + display %, and the
 * id of the active session if one exists (so the UI can jump straight in).
 */

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const examId = params.id;

  try {
    const { data: exam } = await supabaseAdmin
      .from("user_exams")
      .select("id, user_id, title, scope, target_date, ready_threshold, mastery_bkt_target, total_active_seconds, reached_mastery_at, created_at")
      .eq("id", examId)
      .single();

    if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (exam.user_id !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [subRes, progRes, sesRes] = await Promise.all([
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, slug, name, weight, display_order, content_hash, short_summary")
        .eq("user_exam_id", examId)
        .order("display_order"),
      supabaseAdmin
        .from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts, correct, current_streak, display_pct, last_seen_at, last_taught_at, total_active_seconds")
        .eq("user_id", userId),
      supabaseAdmin
        .from("mastery_sessions")
        .select("id, status, last_active_at")
        .eq("user_id", userId)
        .eq("user_exam_id", examId)
        .eq("status", "active")
        .order("last_active_at", { ascending: false })
        .limit(1),
    ]);

    const progressMap = new Map((progRes.data ?? []).map(p => [p.subtopic_id, p]));
    const subtopics = (subRes.data ?? []).map(s => {
      const p = progressMap.get(s.id);
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        weight: s.weight,
        shortSummary: s.short_summary,
        pMastery: p?.p_mastery ?? 0.10,
        attempts: p?.attempts ?? 0,
        correct: p?.correct ?? 0,
        currentStreak: p?.current_streak ?? 0,
        displayPct: p
          ? displayPct(p.p_mastery, p.attempts, exam.mastery_bkt_target)
          : 0,
      };
    });

    const aggregate = pPass(subtopics.map(s => ({ weight: s.weight, pMastery: s.pMastery })));
    const ready = isPassReady(
      subtopics.map(s => ({ weight: s.weight, pMastery: s.pMastery })),
      exam.ready_threshold,
    );
    const mastered = isMasteryReached(
      subtopics.map(s => ({ weight: s.weight, pMastery: s.pMastery })),
      exam.mastery_bkt_target,
    );

    // Weighted display % matches the top bar in the UI
    const totalW = subtopics.reduce((a, s) => a + s.weight, 0) || 1;
    const overallDisplayPct =
      subtopics.reduce((a, s) => a + (s.weight / totalW) * s.displayPct, 0);

    return NextResponse.json({
      exam: {
        id: exam.id,
        title: exam.title,
        scope: exam.scope,
        targetDate: exam.target_date,
        readyThreshold: exam.ready_threshold,
        masteryBktTarget: exam.mastery_bkt_target,
        totalActiveSeconds: exam.total_active_seconds,
        reachedMasteryAt: exam.reached_mastery_at,
        createdAt: exam.created_at,
      },
      subtopics,
      pPass: Math.round(aggregate * 10000) / 10000,
      overallDisplayPct: Math.round(overallDisplayPct * 10) / 10,
      ready,
      mastered,
      activeSessionId: sesRes.data?.[0]?.id ?? null,
    });
  } catch (e) {
    console.error("[mastery/exams/:id GET]", e);
    return NextResponse.json({ error: "Couldn't load this target." }, { status: 500 });
  }
}
