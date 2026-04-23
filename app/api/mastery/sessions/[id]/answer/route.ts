import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { updateBKT, pPass, displayPct, isMasteryReached } from "@/lib/mastery";
import type { Difficulty } from "@/lib/mastery";

/**
 * POST /api/mastery/sessions/[id]/answer
 *
 * Body: { selectedIndex: 0..3, timeMs?: number, challengeToken: string }
 *
 * Validates the challenge token against runtime_state.pending (server owns
 * "what question is in flight"), runs the BKT update, writes the user's
 * answer message + Ninny's feedback message, and — if the answer was wrong
 * and we haven't blown the socratic budget — kicks off a socratic probe
 * ("why'd you pick that?") that gates on a follow-up /socratic call.
 *
 * Response:
 *   { wasCorrect, correctIndex, explanation,
 *     socraticProbe: true | false,
 *     message: <feedback message>,
 *     pPass, displayPct, pMasteryForSubtopic }
 */

const SOCRATIC_TURNS_PER_SESSION = 8; // hard cap on Haiku socratic spends
const STREAK_CONTRIBUTION_CAP = 10;   // matches /api/ninny/complete pattern

type RouteCtx = { params: { id: string } };

interface PendingQuestion {
  type: "question";
  messageId: string;
  subtopicId: string;
  questionId: string;
  challengeToken: string;
}

interface SessionRow {
  id: string; user_id: string; user_exam_id: string; status: string;
  questions_answered: number; correct_count: number;
  socratic_turns_spent: number; reached_mastery_at: string | null;
  runtime_state: {
    pending: PendingQuestion | { type: "teach" | "socratic"; [k: string]: unknown } | null;
    last_subtopic_id: string | null;
    panels_shown_for: Record<string, number>;
    reached_mastery_celebrated: boolean;
  };
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  let body: { selectedIndex?: number; timeMs?: number; challengeToken?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const selectedIndex = Number(body.selectedIndex);
  const token = String(body.challengeToken ?? "");
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3) {
    return NextResponse.json({ error: "selectedIndex must be 0..3" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: "Missing challengeToken" }, { status: 400 });
  }

  try {
    const { data: sessionRow } = await supabaseAdmin
      .from("mastery_sessions")
      .select("id, user_id, user_exam_id, status, questions_answered, correct_count, socratic_turns_spent, reached_mastery_at, runtime_state")
      .eq("id", sessionId)
      .single();

    if (!sessionRow || sessionRow.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const session = sessionRow as SessionRow;
    if (session.status !== "active") {
      return NextResponse.json({ error: "Session is not active" }, { status: 409 });
    }

    const runtime = session.runtime_state;
    const pending = runtime?.pending;
    if (!pending || pending.type !== "question" || (pending as PendingQuestion).challengeToken !== token) {
      return NextResponse.json({ error: "No pending question or token mismatch" }, { status: 409 });
    }
    const pendingQ = pending as PendingQuestion;

    // Load the question (server-side, correct_index never trusted to client)
    const { data: q } = await supabaseAdmin
      .from("mastery_questions")
      .select("id, content_hash, question, options, correct_index, explanation, difficulty, times_shown, times_correct")
      .eq("id", pendingQ.questionId)
      .single();

    if (!q) return NextResponse.json({ error: "Question missing" }, { status: 500 });

    const wasCorrect = selectedIndex === q.correct_index;
    const difficulty = (["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium") as Difficulty;

    // Load exam (for bktTarget) + subtopic + progress for the BKT math
    const [examRes, subRes, progRes] = await Promise.all([
      supabaseAdmin.from("user_exams")
        .select("id, mastery_bkt_target, ready_threshold, reached_mastery_at")
        .eq("id", session.user_exam_id).single(),
      supabaseAdmin.from("mastery_subtopics")
        .select("id, weight")
        .eq("user_exam_id", session.user_exam_id).order("display_order"),
      supabaseAdmin.from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts, correct, current_streak, total_active_seconds, last_taught_at")
        .eq("user_id", userId),
    ]);

    const exam = examRes.data;
    if (!exam) return NextResponse.json({ error: "Exam missing" }, { status: 500 });

    const progMap = new Map((progRes.data ?? []).map(p => [p.subtopic_id, p]));
    const currentProg = progMap.get(pendingQ.subtopicId);
    const currentPMastery = currentProg?.p_mastery ?? 0.10;
    const newPMastery = updateBKT(currentPMastery, wasCorrect, difficulty);

    // Persist BKT update — increment attempts/correct/streak, update display_pct
    const newAttempts = (currentProg?.attempts ?? 0) + 1;
    const newCorrect = (currentProg?.correct ?? 0) + (wasCorrect ? 1 : 0);
    const newStreak = wasCorrect ? (currentProg?.current_streak ?? 0) + 1 : 0;
    const newDisplayPct = displayPct(newPMastery, newAttempts, exam.mastery_bkt_target);

    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from("mastery_progress")
      .upsert({
        user_id: userId,
        subtopic_id: pendingQ.subtopicId,
        p_mastery: newPMastery,
        attempts: newAttempts,
        correct: newCorrect,
        current_streak: newStreak,
        display_pct: newDisplayPct,
        last_seen_at: nowIso,
        updated_at: nowIso,
      }, { onConflict: "user_id,subtopic_id" });

    // Recompute aggregate pPass using updated number for this subtopic
    const aggregateScored = (subRes.data ?? []).map(s => {
      if (s.id === pendingQ.subtopicId) return { weight: s.weight, pMastery: newPMastery };
      const p = progMap.get(s.id);
      return { weight: s.weight, pMastery: p?.p_mastery ?? 0.10 };
    });
    const aggregate = pPass(aggregateScored);

    const weightedDisplay = (() => {
      const totalW = (subRes.data ?? []).reduce((a, s) => a + s.weight, 0) || 1;
      const num = (subRes.data ?? []).reduce((acc, s) => {
        if (s.id === pendingQ.subtopicId) return acc + s.weight * newDisplayPct;
        const p = progMap.get(s.id);
        return acc + s.weight * (p ? displayPct(p.p_mastery, p.attempts, exam.mastery_bkt_target) : 0);
      }, 0);
      return Math.round((num / totalW) * 10) / 10;
    })();

    // Cost gate: post-mastery, don't grant Fangs/streak contributions
    const alreadyMastered = !!session.reached_mastery_at || !!exam.reached_mastery_at;

    // Insert the user's 'answer' message (just the pick + time)
    const { data: answerMsg } = await supabaseAdmin.from("mastery_messages").insert({
      session_id: sessionId,
      role: "user",
      kind: "answer",
      content: null,
      payload: {
        questionId: q.id,
        selectedIndex,
        timeMs: Number(body.timeMs) || null,
      },
      p_pass_after: aggregate,
      display_pct_after: weightedDisplay,
    }).select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at").single();

    // Decide whether to run a Socratic probe. Only if wrong, and only if we
    // still have budget; otherwise surface the bank explanation directly.
    const socraticBudgetLeft = session.socratic_turns_spent < SOCRATIC_TURNS_PER_SESSION;
    const doSocratic = !wasCorrect && socraticBudgetLeft;

    let feedbackMsg: Awaited<ReturnType<typeof insertFeedback>> | null = null;
    const feedbackContent = wasCorrect
      ? pickCorrectOpener(newStreak)
      : "Not quite.";
    const feedbackPayload: Record<string, unknown> = {
      wasCorrect,
      correctIndex: q.correct_index,
      explanation: q.explanation,
      questionId: q.id,
      userSelectedIndex: selectedIndex,
    };
    if (doSocratic) {
      feedbackPayload.pendingSocratic = true;
    }

    feedbackMsg = await insertFeedback({
      sessionId,
      content: feedbackContent,
      payload: feedbackPayload,
      pPassAfter: aggregate,
      displayPctAfter: weightedDisplay,
    });

    // If starting socratic: insert a probe message and set pending
    let socraticProbeMsg: Awaited<ReturnType<typeof insertFeedback>> | null = null;
    if (doSocratic) {
      socraticProbeMsg = await supabaseAdmin.from("mastery_messages").insert({
        session_id: sessionId,
        role: "ninny",
        kind: "socratic_probe",
        content:
          `Before I tell you what's right — what made you pick "${q.options[selectedIndex]}"? ` +
          `One sentence is fine.`,
        payload: { questionId: q.id, userSelectedIndex: selectedIndex },
        p_pass_after: aggregate,
        display_pct_after: weightedDisplay,
      }).select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at").single().then(r => r.data);
    }

    // Update runtime_state: either clear pending (no socratic), or point at the socratic probe
    if (doSocratic && socraticProbeMsg) {
      runtime.pending = {
        type: "socratic",
        messageId: socraticProbeMsg.id,
        subtopicId: pendingQ.subtopicId,
        questionId: q.id,
        userSelectedIndex: selectedIndex,
      };
    } else {
      runtime.pending = null;
    }

    // Session + question bank counters (non-blocking where possible)
    await Promise.all([
      supabaseAdmin.from("mastery_sessions").update({
        runtime_state: runtime,
        questions_answered: session.questions_answered + 1,
        correct_count: session.correct_count + (wasCorrect ? 1 : 0),
        socratic_turns_spent: session.socratic_turns_spent + (doSocratic ? 1 : 0),
        current_p_pass: aggregate,
        last_active_at: nowIso,
      }).eq("id", sessionId),
      supabaseAdmin.from("mastery_events").insert({
        session_id: sessionId, user_id: userId, subtopic_id: pendingQ.subtopicId,
        event_type: "answer", question_id: q.id,
        was_correct: wasCorrect, time_to_answer_ms: Number(body.timeMs) || null,
        p_mastery_after: newPMastery, p_pass_after: aggregate,
      }),
      supabaseAdmin.from("mastery_questions").update({
        times_shown: q.times_shown + 1,
        times_correct: q.times_correct + (wasCorrect ? 1 : 0),
      }).eq("id", q.id),
    ]);

    // Streak contribution — only first 10 questions/session + only pre-mastery
    if (!alreadyMastered && session.questions_answered < STREAK_CONTRIBUTION_CAP) {
      await bumpDailyStreakCounter(userId);
    }

    // Mastery-reached crossing: if this answer just crossed the target,
    // schedule a celebrate card for the next /next call by leaving
    // runtime.reached_mastery_celebrated=false (it already is by default).
    const nowMastered = isMasteryReached(aggregateScored, exam.mastery_bkt_target);
    if (nowMastered && !runtime.reached_mastery_celebrated) {
      // The next /next call will detect and emit the celebration card.
    }

    return NextResponse.json({
      wasCorrect,
      correctIndex: q.correct_index,
      explanation: q.explanation,
      pPass: aggregate,
      displayPct: weightedDisplay,
      pMasteryForSubtopic: newPMastery,
      streakAtSubtopic: newStreak,
      socraticProbe: doSocratic,
      answerMessage: answerMsg ? shapeMessage(answerMsg) : null,
      feedbackMessage: feedbackMsg ? shapeMessage(feedbackMsg) : null,
      socraticProbeMessage: socraticProbeMsg ? shapeMessage(socraticProbeMsg) : null,
    });
  } catch (e) {
    console.error("[mastery/sessions/:id/answer]", e);
    return NextResponse.json({ error: "Couldn't record answer" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function insertFeedback(args: {
  sessionId: string;
  content: string;
  payload: Record<string, unknown>;
  pPassAfter: number;
  displayPctAfter: number;
}) {
  const { data } = await supabaseAdmin.from("mastery_messages").insert({
    session_id: args.sessionId,
    role: "ninny",
    kind: "feedback",
    content: args.content,
    payload: args.payload,
    p_pass_after: args.pPassAfter,
    display_pct_after: args.displayPctAfter,
  }).select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at").single();
  return data;
}

function pickCorrectOpener(streak: number): string {
  if (streak >= 5) return `Five in a row — you're on a run.`;
  if (streak >= 3) return `Three straight. Nice lock-in.`;
  return `Got it.`;
}

function shapeMessage(m: {
  id: string; role: string; kind: string; content: string | null;
  payload: unknown; p_pass_after: number | null; display_pct_after: number | null;
  created_at: string;
}) {
  return {
    id: m.id, role: m.role, kind: m.kind,
    content: m.content, payload: m.payload,
    pPassAfter: m.p_pass_after, displayPctAfter: m.display_pct_after,
    createdAt: m.created_at,
  };
}

/**
 * Bump the daily streak counter on the profile, matching the pattern used
 * by /api/ninny/complete. Best-effort — failure here shouldn't fail the
 * answer. The streak is preserved by `daily_questions_completed` ≥ 10.
 */
async function bumpDailyStreakCounter(userId: string): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("daily_questions_completed, daily_questions_date, last_activity_date, current_streak")
      .eq("id", userId)
      .single();
    if (!profile) return;

    const needReset = profile.daily_questions_date !== today;
    const count = needReset ? 1 : (profile.daily_questions_completed ?? 0) + 1;

    const update: Record<string, unknown> = {
      daily_questions_completed: count,
      daily_questions_date: today,
      last_activity_date: today,
    };
    await supabaseAdmin.from("profiles").update(update).eq("id", userId);
  } catch (e) {
    console.error("[mastery/answer] bumpDailyStreak:", (e as Error).message);
  }
}
