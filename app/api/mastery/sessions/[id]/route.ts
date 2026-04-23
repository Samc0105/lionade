import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { displayPct, pPass, isPassReady, isMasteryReached } from "@/lib/mastery";

/**
 * GET /api/mastery/sessions/[id]
 *
 * The chat thread + all derived progress numbers the UI needs. Returned
 * fields intentionally overlap /exams/[id] so the session page doesn't
 * need a second call on mount.
 *
 * Everything here is read-only; all state mutations flow through the other
 * session routes (next / answer / socratic / heartbeat / complete).
 */

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  try {
    const { data: session } = await supabaseAdmin
      .from("mastery_sessions")
      .select(`
        id, user_id, user_exam_id, status, started_at, last_active_at, ended_at,
        active_seconds, questions_answered, correct_count, teaching_panels_shown,
        explanations_shown, socratic_turns_spent, starting_p_pass, current_p_pass,
        runtime_state, reached_mastery_at
      `)
      .eq("id", sessionId)
      .single();

    if (!session || session.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [examRes, subRes, progRes, msgRes] = await Promise.all([
      supabaseAdmin
        .from("user_exams")
        .select("id, title, ready_threshold, mastery_bkt_target, target_date, total_active_seconds, reached_mastery_at")
        .eq("id", session.user_exam_id)
        .single(),
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, slug, name, weight, display_order, short_summary")
        .eq("user_exam_id", session.user_exam_id)
        .order("display_order"),
      supabaseAdmin
        .from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts, correct, current_streak, display_pct")
        .eq("user_id", userId),
      supabaseAdmin
        .from("mastery_messages")
        .select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at")
        .eq("session_id", sessionId)
        .order("created_at")
        .limit(200),
    ]);

    const exam = examRes.data;
    if (!exam) return NextResponse.json({ error: "Exam missing" }, { status: 500 });

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
    const totalW = subtopics.reduce((a, s) => a + s.weight, 0) || 1;
    const overallDisplayPct =
      subtopics.reduce((a, s) => a + (s.weight / totalW) * s.displayPct, 0);
    const ready = isPassReady(
      subtopics.map(s => ({ weight: s.weight, pMastery: s.pMastery })),
      exam.ready_threshold,
    );
    const mastered = isMasteryReached(
      subtopics.map(s => ({ weight: s.weight, pMastery: s.pMastery })),
      exam.mastery_bkt_target,
    );

    const messages = (msgRes.data ?? []).map(m => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      content: m.content,
      payload: m.payload,
      pPassAfter: m.p_pass_after,
      displayPctAfter: m.display_pct_after,
      createdAt: m.created_at,
    }));

    // The runtime_state.pending is what the UI uses to know what kind of
    // input to offer: a "Continue" button (teach), multiple-choice answer
    // (question), or a text input (socratic).
    const pending = (session.runtime_state as { pending?: unknown })?.pending ?? null;

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        startedAt: session.started_at,
        lastActiveAt: session.last_active_at,
        activeSeconds: session.active_seconds,
        questionsAnswered: session.questions_answered,
        correctCount: session.correct_count,
        teachingPanelsShown: session.teaching_panels_shown,
        explanationsShown: session.explanations_shown,
        socraticTurnsSpent: session.socratic_turns_spent,
        startingPPass: session.starting_p_pass,
        currentPPass: session.current_p_pass ?? aggregate,
        reachedMasteryAt: session.reached_mastery_at,
        pending,
      },
      exam: {
        id: exam.id,
        title: exam.title,
        readyThreshold: exam.ready_threshold,
        masteryBktTarget: exam.mastery_bkt_target,
        targetDate: exam.target_date,
        totalActiveSeconds: exam.total_active_seconds,
        reachedMasteryAt: exam.reached_mastery_at,
      },
      subtopics,
      messages,
      pPass: Math.round(aggregate * 10000) / 10000,
      overallDisplayPct: Math.round(overallDisplayPct * 10) / 10,
      ready,
      mastered,
    });
  } catch (e) {
    console.error("[mastery/sessions/:id GET]", e);
    return NextResponse.json({ error: "Couldn't load session." }, { status: 500 });
  }
}
