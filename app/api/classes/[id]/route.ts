import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { displayPct, pPass } from "@/lib/mastery";

/**
 * GET    /api/classes/[id]  — full class detail (header + exams + notes)
 * PATCH  /api/classes/[id]  — edit name / color / emoji / term / etc
 * DELETE /api/classes/[id]  — soft-archive (rows preserved, just hidden)
 *
 * Detail payload is rich enough to drive the entire notebook page in a
 * single request: class metadata, every active exam target with its
 * mastery summary, and the recent notes.
 */

type RouteCtx = { params: { id: string } };

interface ExamSummary {
  id: string;
  title: string;
  targetDate: string | null;
  reachedMasteryAt: string | null;
  totalActiveSeconds: number;
  pPass: number;
  overallDisplayPct: number;
  subtopicCount: number;
}

interface NoteSummary {
  id: string;
  title: string | null;
  body: string;
  source: string;
  pinned: boolean;
  aiTopics: string[] | null;
  aiSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  try {
    const { data: cls } = await supabaseAdmin
      .from("classes")
      .select("id, user_id, name, short_code, professor, term, color, emoji, archived, position, created_at, updated_at")
      .eq("id", classId)
      .single();

    if (!cls || cls.user_id !== userId || cls.archived) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fan out: exams + their subtopics + their progress, plus notes.
    const [examsRes, notesRes] = await Promise.all([
      supabaseAdmin
        .from("user_exams")
        .select("id, title, target_date, ready_threshold, mastery_bkt_target, total_active_seconds, reached_mastery_at, created_at")
        .eq("user_id", userId)
        .eq("class_id", classId)
        .eq("archived", false)
        .order("target_date", { ascending: true, nullsFirst: false }),
      supabaseAdmin
        .from("class_notes")
        .select("id, title, body, source, pinned, ai_topics, ai_summary, created_at, updated_at")
        .eq("class_id", classId)
        .eq("archived", false)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

    const exams = examsRes.data ?? [];
    let examSummaries: ExamSummary[] = [];

    if (exams.length) {
      const examIds = exams.map(e => e.id);
      const [subRes, progRes] = await Promise.all([
        supabaseAdmin
          .from("mastery_subtopics")
          .select("id, user_exam_id, weight")
          .in("user_exam_id", examIds),
        supabaseAdmin
          .from("mastery_progress")
          .select("subtopic_id, p_mastery, attempts")
          .eq("user_id", userId),
      ]);

      const subsByExam = new Map<string, NonNullable<typeof subRes.data>>();
      for (const s of subRes.data ?? []) {
        if (!subsByExam.has(s.user_exam_id)) subsByExam.set(s.user_exam_id, []);
        subsByExam.get(s.user_exam_id)!.push(s);
      }
      const progBySubtopic = new Map((progRes.data ?? []).map(p => [p.subtopic_id, p]));

      examSummaries = exams.map(e => {
        const subs = subsByExam.get(e.id) ?? [];
        const scored = subs.map(s => {
          const p = progBySubtopic.get(s.id);
          return {
            weight: s.weight,
            pMastery: p?.p_mastery ?? 0.10,
            displayPct: p ? displayPct(p.p_mastery, p.attempts, e.mastery_bkt_target) : 0,
          };
        });
        const totalW = scored.reduce((a, s) => a + s.weight, 0) || 1;
        const overallDisplayPct =
          scored.reduce((a, s) => a + (s.weight / totalW) * s.displayPct, 0);

        return {
          id: e.id,
          title: e.title,
          targetDate: e.target_date,
          reachedMasteryAt: e.reached_mastery_at,
          totalActiveSeconds: e.total_active_seconds,
          pPass: pPass(scored),
          overallDisplayPct: Math.round(overallDisplayPct * 10) / 10,
          subtopicCount: subs.length,
        };
      });
    }

    const notes: NoteSummary[] = (notesRes.data ?? []).map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      source: n.source,
      pinned: n.pinned,
      aiTopics: n.ai_topics,
      aiSummary: n.ai_summary,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));

    return NextResponse.json({
      class: {
        id: cls.id,
        name: cls.name,
        shortCode: cls.short_code,
        professor: cls.professor,
        term: cls.term,
        color: cls.color,
        emoji: cls.emoji,
        position: cls.position,
        createdAt: cls.created_at,
        updatedAt: cls.updated_at,
      },
      exams: examSummaries,
      notes,
    });
  } catch (e) {
    console.error("[classes/:id GET]", e);
    return NextResponse.json({ error: "Couldn't load class." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — edit
// ─────────────────────────────────────────────────────────────────────────────
interface PatchBody {
  name?: string;
  shortCode?: string | null;
  professor?: string | null;
  term?: string | null;
  color?: string;
  emoji?: string | null;
  position?: number;
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  let body: PatchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Verify ownership before mutating.
  const { data: existing } = await supabaseAdmin
    .from("classes")
    .select("id, user_id")
    .eq("id", classId)
    .single();
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (name.length < 2) {
      return NextResponse.json({ error: "Class name must be at least 2 characters." }, { status: 400 });
    }
    update.name = name;
  }
  if (body.shortCode !== undefined) update.short_code = body.shortCode ? String(body.shortCode).trim().slice(0, 24) : null;
  if (body.professor !== undefined) update.professor = body.professor ? String(body.professor).trim().slice(0, 80) : null;
  if (body.term !== undefined)      update.term = body.term ? String(body.term).trim().slice(0, 32) : null;
  if (body.color !== undefined && HEX_COLOR_RE.test(body.color)) update.color = body.color;
  if (body.emoji !== undefined)     update.emoji = body.emoji ? String(body.emoji).slice(0, 4) : null;
  if (typeof body.position === "number") update.position = Math.max(0, Math.floor(body.position));

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const { error } = await supabaseAdmin
    .from("classes")
    .update(update)
    .eq("id", classId)
    .eq("user_id", userId);

  if (error) {
    console.error("[classes/:id PATCH]", error.message);
    return NextResponse.json({ error: "Couldn't update class." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — soft archive
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  // Soft-delete: archive the class (keeps notes + exam history queryable
  // for "restore"). user_exams keep their class_id pointer so unarchiving
  // restores the full structure.
  const { error } = await supabaseAdmin
    .from("classes")
    .update({ archived: true })
    .eq("id", classId)
    .eq("user_id", userId);

  if (error) {
    console.error("[classes/:id DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't archive class." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
