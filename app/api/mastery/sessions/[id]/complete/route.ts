import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { clearActiveSession } from "@/lib/presence";

/**
 * POST /api/mastery/sessions/[id]/complete
 *
 * The user explicitly ends their session (tapped "End session" or similar).
 * Marks the session `abandoned` (we call it `abandoned` rather than
 * `completed` because Mastery Mode doesn't have a "finished the exam"
 * concept — the user decides when they're done) and grants a small Fang
 * reward scaled by questions answered, *only* if they haven't already
 * reached mastery on this exam (which would bypass the earn-gate).
 *
 * Safe to call multiple times — re-posting on an already-closed session
 * returns the prior result.
 */

const BASE_REWARD = 20;
const PER_CORRECT_REWARD = 3;
const REWARD_CAP = 200;

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  try {
    const { data: session } = await supabaseAdmin
      .from("mastery_sessions")
      .select("id, user_id, user_exam_id, status, correct_count, questions_answered, active_seconds, reached_mastery_at")
      .eq("id", sessionId)
      .single();

    if (!session || session.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Idempotent: if already closed, just return the summary
    if (session.status !== "active") {
      // Clear regardless — a repeated /complete call from a stale tab should
      // still purge a lingering active_session pin.
      void clearActiveSession(userId);
      return NextResponse.json({
        alreadyClosed: true,
        sessionId,
        questionsAnswered: session.questions_answered,
        correctCount: session.correct_count,
        activeSeconds: session.active_seconds,
      });
    }

    // Check global mastery state on the exam
    const { data: exam } = await supabaseAdmin
      .from("user_exams")
      .select("id, reached_mastery_at")
      .eq("id", session.user_exam_id)
      .single();

    const alreadyMastered = !!session.reached_mastery_at || !!exam?.reached_mastery_at;

    // Reward: only granted pre-mastery
    let coinsEarned = 0;
    if (!alreadyMastered && session.questions_answered >= 3) {
      coinsEarned = Math.min(
        REWARD_CAP,
        BASE_REWARD + PER_CORRECT_REWARD * session.correct_count,
      );
    }

    const nowIso = new Date().toISOString();

    // Close the session
    await supabaseAdmin
      .from("mastery_sessions")
      .update({
        status: "abandoned",
        ended_at: nowIso,
        last_active_at: nowIso,
      })
      .eq("id", sessionId);

    // Grant Fangs if earned. The session is already closed above (the
    // idempotency gate), so credit through the atomic update_user_coins RPC
    // (no lost-update race + keeps fangs_cashable in sync); the audit row is a
    // separate insert since the RPC only touches the balance columns.
    if (coinsEarned > 0) {
      const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: coinsEarned,
        p_min_balance: 0,
        p_source: "cashable",
      });
      if (creditErr) {
        // Session is already closed (can't retry the grant); log loudly.
        console.error("[mastery/complete] credit:", creditErr.message);
      } else {
        await supabaseAdmin.from("coin_transactions").insert({
          user_id: userId,
          amount: coinsEarned,
          type: "mastery_session",
          description: `Mastery session (${session.correct_count}/${session.questions_answered} correct)`,
        });
      }
    }

    // Earned-cosmetic auto-grant: Mastery medal at 95%+ correct. Fire-and-
    // forget — RPC is idempotent (one medal per (user, exam)) so a user who
    // re-runs an already-mastered exam doesn't double-grant.
    const accuracy = session.questions_answered > 0
      ? session.correct_count / session.questions_answered
      : 0;
    if (accuracy >= 0.95) {
      void supabaseAdmin
        .from("user_exams")
        .select("title")
        .eq("id", session.user_exam_id)
        .single()
        .then(({ data }) => {
          const examName = data?.title ?? "Mastery Exam";
          return supabaseAdmin.rpc("grant_mastery_medal", {
            p_user_id: userId,
            p_exam_id: session.user_exam_id,
            p_exam_name: examName,
          });
        })
        .then((res) => {
          if (res?.error) console.warn("[mastery/complete] grant_mastery_medal:", res.error.message);
        });
    }

    // Drop the active_session pin — the user is finished here.
    void clearActiveSession(userId);

    return NextResponse.json({
      sessionId,
      questionsAnswered: session.questions_answered,
      correctCount: session.correct_count,
      activeSeconds: session.active_seconds,
      coinsEarned,
      alreadyMastered,
    });
  } catch (e) {
    console.error("[mastery/sessions/:id/complete]", e);
    return NextResponse.json({ error: "Couldn't close session" }, { status: 500 });
  }
}
