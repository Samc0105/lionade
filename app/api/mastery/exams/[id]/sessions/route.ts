import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { pPass } from "@/lib/mastery";
import { renderEmail, templates } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";
import { setActiveSession } from "@/lib/presence";

/**
 * POST /api/mastery/exams/[id]/sessions
 *
 * Starts a Mastery Mode session for this exam — or returns the existing
 * active one. Idempotent by design so a double-tap on "Start" never
 * creates orphan sessions.
 *
 * On a truly-new session we seed the chat with a welcoming Ninny message
 * ("Let's get into it — here's what I've got on your plate…") so the thread
 * isn't empty when the UI mounts.
 */

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const examId = params.id;

  try {
    // Ownership check + fetch exam for starting_p_pass snapshot
    const { data: exam } = await supabaseAdmin
      .from("user_exams")
      .select("id, user_id, title, mastery_bkt_target")
      .eq("id", examId)
      .single();

    if (!exam || exam.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resume an existing active session if one exists
    const { data: existing } = await supabaseAdmin
      .from("mastery_sessions")
      .select("id, status")
      .eq("user_id", userId)
      .eq("user_exam_id", examId)
      .eq("status", "active")
      .order("last_active_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Touch last_active_at so the "resume" doesn't look idle.
      await supabaseAdmin
        .from("mastery_sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", existing.id);
      void setActiveSession(userId, "mastery_session", existing.id, "player");
      return NextResponse.json({ sessionId: existing.id, resumed: true });
    }

    // ── Otherwise create a fresh session ──────────────────────────────────
    const { data: subs } = await supabaseAdmin
      .from("mastery_subtopics")
      .select("id, weight, name")
      .eq("user_exam_id", examId)
      .order("display_order");

    const { data: existingProgress } = await supabaseAdmin
      .from("mastery_progress")
      .select("subtopic_id, p_mastery")
      .eq("user_id", userId);

    const progressMap = new Map((existingProgress ?? []).map(p => [p.subtopic_id, p.p_mastery]));
    const startPPass = pPass(
      (subs ?? []).map(s => ({ weight: s.weight, pMastery: progressMap.get(s.id) ?? 0.10 })),
    );

    const { data: session, error: sesErr } = await supabaseAdmin
      .from("mastery_sessions")
      .insert({
        user_id: userId,
        user_exam_id: examId,
        status: "active",
        starting_p_pass: startPPass,
        current_p_pass: startPPass,
        runtime_state: {
          pending: null,
          last_subtopic_id: null,
          panels_shown_for: {},
          reached_mastery_celebrated: false,
        },
      })
      .select("id")
      .single();

    if (sesErr || !session) {
      console.error("[mastery/exams/:id/sessions POST] insert:", sesErr?.message);
      return NextResponse.json({ error: "Couldn't start session." }, { status: 500 });
    }

    // Seed with an opening Ninny message so the thread isn't empty on first render.
    const subtopicLine = (subs ?? [])
      .slice(0, 4)
      .map(s => s.name)
      .join(", ");

    await supabaseAdmin.from("mastery_messages").insert({
      session_id: session.id,
      role: "ninny",
      kind: "text",
      content:
        `Alright — ${exam.title}. I've broken it into ${subs?.length ?? 0} ` +
        `subtopics${subtopicLine ? ` (${subtopicLine}${(subs?.length ?? 0) > 4 ? ", …" : ""})` : ""}. ` +
        `I'll teach where you're cold and quiz where you're warm. Hit "Continue" when you're ready.`,
      payload: { opening: true },
      p_pass_after: startPPass,
      display_pct_after: 0,
    });

    // Ensure progress rows exist for every subtopic (so we don't race later
    // trying to upsert inside the answer route).
    if (subs?.length) {
      const seedRows = subs
        .filter(s => !progressMap.has(s.id))
        .map(s => ({ user_id: userId, subtopic_id: s.id }));
      if (seedRows.length) {
        await supabaseAdmin.from("mastery_progress").insert(seedRows);
      }
    }

    // First-ever Mastery session email — fires once per (user, exam) pair.
    // Sam's intent in plain English: "congrats on starting ur mastery on
    // whatever subjects" — i.e. when a user starts mastery on AWS Sec, they
    // get one. When they later start mastery on Biology, they get another.
    // A second session on the SAME exam (manual re-start after closing the
    // active one) does NOT re-trigger — the gate filters by user_exam_id.
    //
    // Note: "resume" returns early at line 58, so we only get here on a
    // truly fresh session insert. The count below is the additional defense
    // against the rare race where two parallel POSTs both reach the insert
    // (the `.neq("id", session.id)` excludes the row we just inserted).
    //
    // Best-effort; never breaks the API. Phase 1.5 wiring (was per-user
    // across-all-exams in Phase 1; corrected to per-exam in Phase 1.5).
    try {
      if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
        const { count: priorSessions } = await supabaseAdmin
          .from("mastery_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("user_exam_id", examId)
          .neq("id", session.id);

        if ((priorSessions ?? 0) === 0) {
          const [{ data: authUser }, { data: profile }] = await Promise.all([
            supabaseAdmin.auth.admin.getUserById(userId),
            supabaseAdmin.from("profiles").select("display_name").eq("id", userId).single(),
          ]);
          const toEmail = authUser?.user?.email;
          if (toEmail) {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const rendered = renderEmail(templates.masteryStart, {
              userName: (profile?.display_name as string | null) || undefined,
              subjectName: exam.title,
              ctaUrl: absoluteUrl(`/learn/mastery/${examId}`),
              ctaLabel: "Open Mastery",
            });
            const { error: emailErr } = await resend.emails.send({
              from: process.env.EMAIL_FROM,
              to: toEmail,
              replyTo: "support@getlionade.com",
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.text,
            });
            if (emailErr) {
              console.warn("[mastery/exams/:id/sessions] masteryStart email failed:", JSON.stringify(emailErr));
            }
          }
        }
      }
    } catch (masteryEmailErr) {
      // Non-fatal — never block session creation on email failure
      console.warn("[mastery/exams/:id/sessions] masteryStart email WARN:", masteryEmailErr);
    }

    void setActiveSession(userId, "mastery_session", session.id, "player");

    return NextResponse.json({ sessionId: session.id, resumed: false });
  } catch (e) {
    console.error("[mastery/exams/:id/sessions POST]", e);
    return NextResponse.json({ error: "Couldn't start session." }, { status: 500 });
  }
}
