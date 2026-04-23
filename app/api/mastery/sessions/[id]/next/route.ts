import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  displayPct, pPass, isMasteryReached, pickNextSubtopic, pickDifficulty,
} from "@/lib/mastery";
import {
  getOrGenerateTeachingPanel, getOrGenerateQuestion,
} from "@/lib/mastery-content";

/**
 * POST /api/mastery/sessions/[id]/next
 *
 * The orchestrator. Given an active session, decides what to show the user
 * next and persists that decision. The client is never trusted to pick —
 * it just renders what this route returns.
 *
 * Return shapes (always mirrors what we just wrote to mastery_messages):
 *   { kind: "teach",    message, panel, subtopicId }
 *   { kind: "question", message, question, challengeToken, subtopicId }
 *   { kind: "celebrate", message, reason: "ready" | "mastered" }
 *   { kind: "done",     summary }       — unreachable in v1 (session never auto-ends)
 */

// Hard caps to bound Claude spend per session
const TEACH_PANELS_PER_SUBTOPIC = 3;
const TEACH_PANELS_SESSION_CAP = 12;

type RouteCtx = { params: { id: string } };

interface SessionRow {
  id: string; user_id: string; user_exam_id: string; status: string;
  teaching_panels_shown: number; explanations_shown: number;
  socratic_turns_spent: number; questions_answered: number; correct_count: number;
  runtime_state: {
    pending: {
      type: "teach" | "question" | "socratic";
      messageId: string;
      subtopicId: string;
      questionId?: string;
      challengeToken?: string;
    } | null;
    last_subtopic_id: string | null;
    panels_shown_for: Record<string, number>;
    reached_mastery_celebrated: boolean;
  };
  reached_mastery_at: string | null;
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  // Optional body hint — client may pre-fetch questions and ask the
  // orchestrator to serve a specific one. Server validates it still belongs
  // to this exam and hasn't been answered in this session.
  let preferredQuestionId: string | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.preferredQuestionId === "string") {
      preferredQuestionId = body.preferredQuestionId;
    }
  } catch { /* no body is fine */ }

  try {
    // Load session + validate ownership
    const { data: sessionRow } = await supabaseAdmin
      .from("mastery_sessions")
      .select("id, user_id, user_exam_id, status, teaching_panels_shown, explanations_shown, socratic_turns_spent, questions_answered, correct_count, runtime_state, reached_mastery_at")
      .eq("id", sessionId)
      .single();

    if (!sessionRow || sessionRow.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const session = sessionRow as SessionRow;
    if (session.status !== "active") {
      return NextResponse.json({ error: "Session is not active" }, { status: 409 });
    }
    const runtime = session.runtime_state ?? {
      pending: null, last_subtopic_id: null, panels_shown_for: {}, reached_mastery_celebrated: false,
    };

    // ── Resume: if there's a pending card, re-serve it ──────────────────────
    if (runtime.pending) {
      const { data: msg } = await supabaseAdmin
        .from("mastery_messages")
        .select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at")
        .eq("id", runtime.pending.messageId)
        .single();
      if (msg) {
        return NextResponse.json({
          kind: runtime.pending.type === "socratic" ? "socratic_probe" : runtime.pending.type,
          message: shapeMessage(msg),
          resumed: true,
        });
      }
      // Stale pending — fall through and pick fresh.
      runtime.pending = null;
    }

    // Load exam + subtopics + progress
    const { data: exam } = await supabaseAdmin
      .from("user_exams")
      .select("id, title, ready_threshold, mastery_bkt_target")
      .eq("id", session.user_exam_id)
      .single();
    if (!exam) return NextResponse.json({ error: "Exam missing" }, { status: 500 });

    const [subRes, progRes, seenEventsRes] = await Promise.all([
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, name, weight, display_order, content_hash")
        .eq("user_exam_id", session.user_exam_id)
        .order("display_order"),
      supabaseAdmin
        .from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts, last_taught_at, last_seen_at")
        .eq("user_id", userId),
      supabaseAdmin
        .from("mastery_events")
        .select("question_id")
        .eq("session_id", sessionId)
        .not("question_id", "is", null),
    ]);

    const subs = subRes.data ?? [];
    if (!subs.length) return NextResponse.json({ error: "No subtopics for this exam" }, { status: 500 });

    const progMap = new Map((progRes.data ?? []).map(p => [p.subtopic_id, p]));
    const seenQuestionIds: string[] = (seenEventsRes.data ?? [])
      .map(e => e.question_id as string | null)
      .filter((x): x is string => !!x);

    const subtopicsForScore = subs.map(s => {
      const p = progMap.get(s.id);
      return {
        subtopicId: s.id,
        weight: s.weight,
        pMastery: p?.p_mastery ?? 0.10,
        lastSeenAt: p?.last_seen_at ? new Date(p.last_seen_at).getTime() : null,
      };
    });

    const mastered = isMasteryReached(
      subtopicsForScore.map(s => ({ weight: s.weight, pMastery: s.pMastery })),
      exam.mastery_bkt_target,
    );

    // One-shot celebration when they first hit mastery inside this session
    if (mastered && !runtime.reached_mastery_celebrated) {
      const aggregate = pPass(subtopicsForScore.map(s => ({ weight: s.weight, pMastery: s.pMastery })));

      const { data: msg } = await supabaseAdmin.from("mastery_messages").insert({
        session_id: sessionId,
        role: "ninny",
        kind: "celebrate",
        content:
          `That's mastery. Every subtopic above the threshold — you know this material cold. ` +
          `You can keep practicing; future answers won't earn Fangs but I'll keep tracking your stats.`,
        payload: { reason: "mastered" },
        p_pass_after: aggregate,
        display_pct_after: 100,
      }).select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at").single();

      runtime.reached_mastery_celebrated = true;
      const nowIso = new Date().toISOString();
      await supabaseAdmin
        .from("mastery_sessions")
        .update({
          runtime_state: runtime,
          reached_mastery_at: session.reached_mastery_at ?? nowIso,
          current_p_pass: aggregate,
          last_active_at: nowIso,
        })
        .eq("id", sessionId);

      // Also set on the user_exam (first-ever mastery timestamp)
      await supabaseAdmin
        .from("user_exams")
        .update({ reached_mastery_at: new Date(nowIso).toISOString() })
        .eq("id", session.user_exam_id)
        .is("reached_mastery_at", null);

      await supabaseAdmin.from("mastery_events").insert({
        session_id: sessionId, user_id: userId, event_type: "mastery_reached",
        p_pass_after: aggregate,
      });

      return NextResponse.json({
        kind: "celebrate",
        message: msg ? shapeMessage(msg) : null,
        reason: "mastered",
      });
    }

    // ── Preferred-question fast path (client pre-fetch queue) ──────────────
    //    If the client passed `preferredQuestionId`, verify it belongs to one
    //    of this exam's subtopics and hasn't been answered in this session
    //    yet. If valid, skip the teach decision and serve it directly — the
    //    client already has the question data staged and expects it next.
    if (preferredQuestionId && !seenQuestionIds.includes(preferredQuestionId)) {
      const hashToSub = new Map(subs.map(s => [s.content_hash, s]));
      const { data: pq } = await supabaseAdmin
        .from("mastery_questions")
        .select("id, content_hash, question, options, correct_index, explanation, difficulty")
        .eq("id", preferredQuestionId)
        .eq("status", "approved")
        .maybeSingle();

      const matchedSub = pq ? hashToSub.get(pq.content_hash) : null;
      if (pq && matchedSub) {
        const challengeToken = crypto.randomBytes(16).toString("hex");
        const aggregate = pPass(subtopicsForScore.map(s => ({ weight: s.weight, pMastery: s.pMastery })));
        const dispPct = weightedDisplay(subtopicsForScore, progMap, exam.mastery_bkt_target);
        const options = Array.isArray(pq.options)
          ? (pq.options as unknown[]).map(o => String(o ?? "")) as [string, string, string, string]
          : ["", "", "", ""] as [string, string, string, string];
        const difficulty = (["easy", "medium", "hard"].includes(pq.difficulty)
          ? pq.difficulty : "medium") as "easy" | "medium" | "hard";

        const { data: msg, error: msgErr } = await supabaseAdmin.from("mastery_messages").insert({
          session_id: sessionId,
          role: "ninny",
          kind: "question",
          content: pq.question,
          payload: {
            questionId: pq.id,
            subtopicId: matchedSub.id,
            subtopicName: matchedSub.name,
            options,
            difficulty,
            challengeToken,
          },
          p_pass_after: aggregate,
          display_pct_after: dispPct,
        }).select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at").single();

        if (!msgErr && msg) {
          runtime.pending = {
            type: "question",
            messageId: msg.id,
            subtopicId: matchedSub.id,
            questionId: pq.id,
            challengeToken,
          };
          runtime.last_subtopic_id = matchedSub.id;

          const nowIso = new Date().toISOString();
          await Promise.all([
            supabaseAdmin
              .from("mastery_sessions")
              .update({ runtime_state: runtime, current_p_pass: aggregate, last_active_at: nowIso })
              .eq("id", sessionId),
            supabaseAdmin.from("mastery_events").insert({
              session_id: sessionId, user_id: userId, subtopic_id: matchedSub.id,
              event_type: "question_served", question_id: pq.id,
              ai_model: null, ai_cost_micro_usd: 0,  // cache hit by definition
              p_pass_after: aggregate,
            }),
          ]);

          return NextResponse.json({
            kind: "question",
            message: shapeMessage(msg),
            subtopicId: matchedSub.id,
            challengeToken,
          });
        }
      }
      // Preferred question invalid / insertion failed — fall through to normal pick.
    }

    // Pick next subtopic: prefer weighted-gap leader; if mastered, fall back
    // to any subtopic so the practice-forever mode still has something to drill.
    let picked = pickNextSubtopic(subtopicsForScore);
    if (!picked) {
      // All gaps closed — pick lowest-mastery subtopic as a "keep sharp" pick.
      const sorted = [...subtopicsForScore].sort((a, b) => a.pMastery - b.pMastery);
      picked = sorted[0]?.subtopicId ?? null;
    }
    if (!picked) return NextResponse.json({ error: "Couldn't pick subtopic" }, { status: 500 });

    const pickedSub = subs.find(s => s.id === picked)!;
    const pickedProg = progMap.get(picked);
    const pMastery = pickedProg?.p_mastery ?? 0.10;

    // ── Decide: teach or question? ──────────────────────────────────────────
    const panelsShown = runtime.panels_shown_for?.[picked] ?? 0;
    const sessionPanelsShown = session.teaching_panels_shown ?? 0;

    // Teach if this is the first time we're entering this subtopic in this
    // session (regardless of mastery — users hate being quizzed on something
    // Ninny never introduced), OR if mastery is still shaky and we have
    // budget left.
    const firstTimeThisSubtopic = panelsShown === 0;
    const needsFreshTeach =
      (firstTimeThisSubtopic || pMastery < 0.50) &&
      panelsShown < TEACH_PANELS_PER_SUBTOPIC &&
      sessionPanelsShown < TEACH_PANELS_SESSION_CAP &&
      runtime.last_subtopic_id !== picked; // don't teach twice in a row on same subtopic

    if (needsFreshTeach) {
      const { panel, costMicroUsd, cacheHit } = await getOrGenerateTeachingPanel({
        examTitle: exam.title,
        subtopicName: pickedSub.name,
        contentHash: pickedSub.content_hash,
        panelOrder: panelsShown,
        userIdForTelemetry: userId,
      });

      if (!panel) {
        // Fall through to question path if we couldn't teach
      } else {
        const aggregate = pPass(subtopicsForScore.map(s => ({ weight: s.weight, pMastery: s.pMastery })));
        const dispPct = weightedDisplay(subtopicsForScore, progMap, exam.mastery_bkt_target);

        const { data: msg, error: msgErr } = await supabaseAdmin.from("mastery_messages").insert({
          session_id: sessionId,
          role: "ninny",
          kind: "teach",
          content: panel.tldr,
          payload: {
            panelId: panel.id,
            subtopicId: picked,
            subtopicName: pickedSub.name,
            title: panel.title,
            tldr: panel.tldr,
            bullets: panel.bullets,
            mnemonic: panel.mnemonic,
            commonPitfall: panel.commonPitfall,
            panelOrder: panel.panelOrder,
            cacheHit,
          },
          p_pass_after: aggregate,
          display_pct_after: dispPct,
        }).select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at").single();

        if (msgErr || !msg) {
          console.error("[mastery/next] insert teach message:", msgErr?.message);
          return NextResponse.json({ error: "Couldn't save message" }, { status: 500 });
        }

        // Update session + progress + event log
        runtime.panels_shown_for = { ...(runtime.panels_shown_for ?? {}), [picked]: panelsShown + 1 };
        runtime.last_subtopic_id = picked;
        runtime.pending = null; // teach messages don't need a pending — user clicks Continue → /next again

        const nowIso = new Date().toISOString();
        await Promise.all([
          supabaseAdmin
            .from("mastery_sessions")
            .update({
              runtime_state: runtime,
              teaching_panels_shown: sessionPanelsShown + 1,
              current_p_pass: aggregate,
              last_active_at: nowIso,
            })
            .eq("id", sessionId),
          supabaseAdmin
            .from("mastery_progress")
            .update({ last_taught_at: nowIso, updated_at: nowIso })
            .eq("user_id", userId)
            .eq("subtopic_id", picked),
          supabaseAdmin.from("mastery_events").insert({
            session_id: sessionId, user_id: userId, subtopic_id: picked,
            event_type: "teach_served",
            ai_model: cacheHit ? null : "gpt-4o",
            ai_cost_micro_usd: cacheHit ? 0 : costMicroUsd,
            p_pass_after: aggregate,
          }),
        ]);

        return NextResponse.json({
          kind: "teach",
          message: shapeMessage(msg),
          subtopicId: picked,
        });
      }
    }

    // ── Question path ───────────────────────────────────────────────────────
    const difficulty = pickDifficulty(pMastery);
    const { question, costMicroUsd, cacheHit } = await getOrGenerateQuestion({
      examTitle: exam.title,
      subtopicName: pickedSub.name,
      contentHash: pickedSub.content_hash,
      difficulty,
      avoidIds: seenQuestionIds,
      userIdForTelemetry: userId,
    });

    if (!question) {
      return NextResponse.json({ error: "Couldn't serve a question" }, { status: 500 });
    }

    const challengeToken = crypto.randomBytes(16).toString("hex");
    const aggregate = pPass(subtopicsForScore.map(s => ({ weight: s.weight, pMastery: s.pMastery })));
    const dispPct = weightedDisplay(subtopicsForScore, progMap, exam.mastery_bkt_target);

    const { data: msg, error: msgErr } = await supabaseAdmin.from("mastery_messages").insert({
      session_id: sessionId,
      role: "ninny",
      kind: "question",
      content: question.question,
      payload: {
        questionId: question.id,
        subtopicId: picked,
        subtopicName: pickedSub.name,
        options: question.options,
        difficulty: question.difficulty,
        challengeToken,
        // correctIndex intentionally NOT included — don't send answers to the client
      },
      p_pass_after: aggregate,
      display_pct_after: dispPct,
    }).select("id, role, kind, content, payload, p_pass_after, display_pct_after, created_at").single();

    if (msgErr || !msg) {
      console.error("[mastery/next] insert question message:", msgErr?.message);
      return NextResponse.json({ error: "Couldn't save question" }, { status: 500 });
    }

    runtime.pending = {
      type: "question",
      messageId: msg.id,
      subtopicId: picked,
      questionId: question.id,
      challengeToken,
    };
    runtime.last_subtopic_id = picked;

    const nowIso = new Date().toISOString();
    await Promise.all([
      supabaseAdmin
        .from("mastery_sessions")
        .update({ runtime_state: runtime, current_p_pass: aggregate, last_active_at: nowIso })
        .eq("id", sessionId),
      supabaseAdmin.from("mastery_events").insert({
        session_id: sessionId, user_id: userId, subtopic_id: picked,
        event_type: "question_served", question_id: question.id,
        ai_model: cacheHit ? null : "gpt-4o",
        ai_cost_micro_usd: cacheHit ? 0 : costMicroUsd,
        p_pass_after: aggregate,
      }),
    ]);

    // Don't leak correct_index back in the response payload.
    return NextResponse.json({
      kind: "question",
      message: shapeMessage(msg),
      subtopicId: picked,
      challengeToken,
    });
  } catch (e) {
    console.error("[mastery/sessions/:id/next]", e);
    return NextResponse.json({ error: "Orchestrator error" }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

function weightedDisplay(
  scored: { subtopicId: string; weight: number }[],
  progMap: Map<string, { p_mastery?: number | null; attempts?: number | null } | undefined>,
  bktTarget: number,
): number {
  let total = 0, num = 0;
  for (const s of scored) {
    total += s.weight;
    const p = progMap.get(s.subtopicId);
    const pct = p ? displayPct(p.p_mastery ?? 0.10, p.attempts ?? 0, bktTarget) : 0;
    num += s.weight * pct;
  }
  return total > 0 ? Math.round((num / total) * 10) / 10 : 0;
}
