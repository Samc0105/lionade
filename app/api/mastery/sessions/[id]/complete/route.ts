import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

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

    // Grant Fangs if earned. Match the shape of other reward inserts in the codebase.
    if (coinsEarned > 0) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("coins")
        .eq("id", userId)
        .single();

      if (profile) {
        const newBalance = (profile.coins ?? 0) + coinsEarned;
        await Promise.all([
          supabaseAdmin.from("profiles").update({ coins: newBalance }).eq("id", userId),
          supabaseAdmin.from("coin_transactions").insert({
            user_id: userId,
            amount: coinsEarned,
            type: "mastery_session",
            description: `Mastery session (${session.correct_count}/${session.questions_answered} correct)`,
          }),
        ]);
      }
    }

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
