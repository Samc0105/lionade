import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/mastery/sessions/[id]/heartbeat
 *
 * Body: { deltaSeconds: number }   — time elapsed since the last heartbeat
 *                                   while the tab was visible AND user was
 *                                   active. Clamped server-side to 15s max.
 *
 * Bumps the session's active_seconds, the per-subtopic total_active_seconds
 * (split across subtopics by rough time allocation — we credit the
 * currently-focused subtopic, fallback last_subtopic_id), and the exam's
 * rolled-up total_active_seconds.
 *
 * Chatty endpoint — rate-limited to 30/min in middleware. We keep it cheap
 * (no Claude, just small UPDATEs) so the per-user AFK telemetry is nearly
 * free.
 */

const MAX_DELTA_SECONDS = 15;  // sanity cap; client sends ~10 per beacon

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  let body: { deltaSeconds?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const delta = Math.max(1, Math.min(MAX_DELTA_SECONDS, Math.floor(Number(body.deltaSeconds) || 0)));
  if (delta <= 0) return NextResponse.json({ ok: true, credited: 0 });

  try {
    const { data: session } = await supabaseAdmin
      .from("mastery_sessions")
      .select("id, user_id, user_exam_id, status, active_seconds, runtime_state")
      .eq("id", sessionId)
      .single();

    if (!session || session.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (session.status !== "active") {
      // Quietly no-op on non-active sessions — client might still be pinging.
      return NextResponse.json({ ok: true, credited: 0 });
    }

    const nowIso = new Date().toISOString();
    const lastSubtopicId = (session.runtime_state as { last_subtopic_id?: string | null })?.last_subtopic_id ?? null;

    await Promise.all([
      supabaseAdmin
        .from("mastery_sessions")
        .update({
          active_seconds: (session.active_seconds ?? 0) + delta,
          last_active_at: nowIso,
        })
        .eq("id", sessionId),
      // Rolling per-exam total so the landing page shows "Time to master"
      supabaseAdmin.rpc("increment_user_exam_active", {
        p_user_exam_id: session.user_exam_id,
        p_seconds: delta,
      }).then(() => {}, async () => {
        // RPC may not exist yet — fall back to a read-modify-write UPDATE.
        const { data: exam } = await supabaseAdmin
          .from("user_exams")
          .select("total_active_seconds")
          .eq("id", session.user_exam_id)
          .single();
        if (exam) {
          await supabaseAdmin
            .from("user_exams")
            .update({ total_active_seconds: (exam.total_active_seconds ?? 0) + delta })
            .eq("id", session.user_exam_id);
        }
      }),
    ]);

    // Per-subtopic credit: attribute the delta to the currently-focused subtopic
    if (lastSubtopicId) {
      const { data: prog } = await supabaseAdmin
        .from("mastery_progress")
        .select("total_active_seconds")
        .eq("user_id", userId)
        .eq("subtopic_id", lastSubtopicId)
        .maybeSingle();
      if (prog) {
        await supabaseAdmin
          .from("mastery_progress")
          .update({ total_active_seconds: (prog.total_active_seconds ?? 0) + delta })
          .eq("user_id", userId)
          .eq("subtopic_id", lastSubtopicId);
      }
    }

    return NextResponse.json({ ok: true, credited: delta });
  } catch (e) {
    console.error("[mastery/sessions/:id/heartbeat]", e);
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 });
  }
}
