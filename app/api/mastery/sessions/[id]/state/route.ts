import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * /api/mastery/sessions/[id]/state — refresh-resumable scratch state.
 *
 * GET  → return the saved `{ current_question_id, partial_answer, answered_count,
 *        correct_count, last_active_at }` row for this (user, session). Used on
 *        page mount so a refresh restores the in-progress textarea draft + skips
 *        re-animating the question intro.
 *
 * POST → upsert the row from a debounced client autosave. Body is the partial
 *        client state. We trust user_id from the session, never from the body.
 *
 * Rate-limited to 60/min in middleware (`mastery-state` bucket) — debounced
 * client autosaves should be well under that ceiling.
 *
 * Schema (Phase 1 migration):
 *   mastery_session_state (
 *     user_id uuid,
 *     session_id uuid PRIMARY KEY,
 *     current_question_id uuid,
 *     partial_answer text,
 *     answered_count int default 0,
 *     correct_count int default 0,
 *     last_active_at timestamptz default now()
 *   )
 *
 * Phase 2 — Tier 3 refresh-resumable state. Web ships; iOS port should mirror
 * via AsyncStorage cache for offline-resilient writes (debounce server writes,
 * optimistic local restore on mount). See IOS_PARITY.md row 2026-06-04.
 */

const MAX_PARTIAL_CHARS = 2000;

type RouteCtx = { params: { id: string } };

interface MasteryStateBody {
  current_question_id?: string | null;
  partial_answer?: string | null;
  answered_count?: number;
  correct_count?: number;
}

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  try {
    // RLS would normally cover this, but we use the admin client and gate
    // by user_id ourselves so the row is never returned to the wrong user.
    const { data, error } = await supabaseAdmin
      .from("mastery_session_state")
      .select("user_id, session_id, current_question_id, partial_answer, answered_count, correct_count, last_active_at")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      console.warn("[mastery/sessions/:id/state GET]", error.message);
      return NextResponse.json({ state: null });
    }
    if (!data || data.user_id !== userId) {
      return NextResponse.json({ state: null });
    }

    return NextResponse.json({
      state: {
        currentQuestionId: data.current_question_id,
        partialAnswer: data.partial_answer,
        answeredCount: data.answered_count,
        correctCount: data.correct_count,
        lastActiveAt: data.last_active_at,
      },
    });
  } catch (e) {
    console.error("[mastery/sessions/:id/state GET]", e);
    return NextResponse.json({ state: null });
  }
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  let body: MasteryStateBody;
  try { body = (await req.json()) as MasteryStateBody; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Confirm the session belongs to the user before we write anything.
  const { data: session } = await supabaseAdmin
    .from("mastery_sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const partial = body.partial_answer == null
    ? null
    : String(body.partial_answer).slice(0, MAX_PARTIAL_CHARS);

  try {
    const { error } = await supabaseAdmin
      .from("mastery_session_state")
      .upsert(
        {
          user_id: userId,
          session_id: sessionId,
          current_question_id: body.current_question_id ?? null,
          partial_answer: partial,
          answered_count: typeof body.answered_count === "number" ? body.answered_count : 0,
          correct_count: typeof body.correct_count === "number" ? body.correct_count : 0,
          last_active_at: new Date().toISOString(),
        },
        { onConflict: "session_id" },
      );
    if (error) {
      console.error("[mastery/sessions/:id/state POST]", error.message);
      return NextResponse.json({ error: "Couldn't save state" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[mastery/sessions/:id/state POST]", e);
    return NextResponse.json({ error: "Couldn't save state" }, { status: 500 });
  }
}
