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

/**
 * True when an RPC call failed because the function doesn't exist yet (the
 * migration hasn't been applied). PostgREST surfaces this as PGRST202; Postgres
 * uses SQLSTATE 42883 (undefined_function). Lets the route fall back to the
 * prior behavior so it's safe to merge before the migration is applied.
 */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "PGRST202" || err.code === "42883") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("could not find the function") || m.includes("does not exist");
}

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

    // Atomic close-CLAIM: only the caller that actually flips active->abandoned
    // proceeds to credit. The .eq("status","active") makes this a compare-and-set,
    // so two concurrent /complete calls (double-tap "End session", or a client
    // retry of a slow first request) cannot both pass — the read-gate at line 57
    // is NOT atomic, so without this both callers would read status==='active',
    // both flip the row, and both credit. The loser here gets claimed===null and
    // returns the already-closed summary WITHOUT crediting.
    const { data: claimed } = await supabaseAdmin
      .from("mastery_sessions")
      .update({
        status: "abandoned",
        ended_at: nowIso,
        last_active_at: nowIso,
      })
      .eq("id", sessionId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (!claimed) {
      // Lost the race: another /complete already closed this session. Do NOT
      // credit (the winner did). Purge the active pin and report already-closed.
      void clearActiveSession(userId);
      return NextResponse.json({
        alreadyClosed: true,
        sessionId,
        questionsAnswered: session.questions_answered,
        correctCount: session.correct_count,
        activeSeconds: session.active_seconds,
      });
    }

    // Grant Fangs if earned. We WON the atomic close-claim above, so exactly one
    // caller reaches here per session — that (not merely "the session is closed")
    // is what prevents a double credit. Credit + audit-log atomically through
    // credit_user_coins_logged (balance + coin_transactions row commit or roll
    // back together — kills the dual-ledger drift where a failed audit insert
    // left coins incremented with no ledger row).
    if (coinsEarned > 0) {
      const description = `Mastery session (${session.correct_count}/${session.questions_answered} correct)`;
      const { error: creditErr } = await supabaseAdmin.rpc("credit_user_coins_logged", {
        p_user_id: userId,
        p_delta: coinsEarned,
        p_source: "cashable",
        p_type: "mastery_session",
        p_description: description,
      });

      if (creditErr && isMissingFunction(creditErr)) {
        // Migration not applied yet — fall back to the prior two-step path so
        // this route is safe to merge before the RPC exists.
        const { error: legacyErr } = await supabaseAdmin.rpc("update_user_coins", {
          p_user_id: userId,
          p_delta: coinsEarned,
          p_min_balance: 0,
          p_source: "cashable",
        });
        if (legacyErr) {
          console.error("[mastery/complete] credit:", legacyErr.message);
          coinsEarned = 0;
        } else {
          await supabaseAdmin.from("coin_transactions").insert({
            user_id: userId,
            amount: coinsEarned,
            type: "mastery_session",
            description,
          });
        }
      } else if (creditErr) {
        // Atomic RPC failed — balance AND ledger both rolled back, nothing
        // half-written. Session is already closed (can't retry); log and report
        // zero so the client total reflects what was actually granted.
        console.error("[mastery/complete] credit:", creditErr.message);
        coinsEarned = 0;
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
