import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET  /api/classes  — list the caller's active classes with summary
 * POST /api/classes  — create a new class
 *
 * A class is a user-owned container that bundles:
 *   - notes (class_notes table)
 *   - mastery targets (user_exams.class_id)
 *   - a daily AI plan (class_daily_plans)
 *
 * The summary returned by GET joins all three so the index page can
 * render rich cards in a single round-trip (next exam date, exam count,
 * note count) without N+1 fetching.
 */

interface ClassSummary {
  id: string;
  name: string;
  shortCode: string | null;
  professor: string | null;
  term: string | null;
  color: string;
  emoji: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  examCount: number;
  noteCount: number;
  /** ISO date of the soonest upcoming exam in this class, or null. */
  nextExamDate: string | null;
  /** Aggregate display % across the class's exam(s). 0 if no exams yet. */
  overallDisplayPct: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — list
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: classes, error } = await supabaseAdmin
      .from("classes")
      .select("id, name, short_code, professor, term, color, emoji, position, created_at, updated_at")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;
    if (!classes?.length) return NextResponse.json({ classes: [] });

    const classIds = classes.map(c => c.id);

    // Fan out: exams + notes counts in parallel.
    const [examsRes, notesRes] = await Promise.all([
      supabaseAdmin
        .from("user_exams")
        .select("id, class_id, target_date, mastery_bkt_target, total_active_seconds, reached_mastery_at")
        .in("class_id", classIds)
        .eq("archived", false),
      supabaseAdmin
        .from("class_notes")
        .select("id, class_id")
        .in("class_id", classIds)
        .eq("archived", false),
    ]);

    const examsByClass = new Map<string, NonNullable<typeof examsRes.data>>();
    for (const e of examsRes.data ?? []) {
      if (!e.class_id) continue;
      const list = examsByClass.get(e.class_id) ?? [];
      list.push(e);
      examsByClass.set(e.class_id, list);
    }

    const noteCountByClass = new Map<string, number>();
    for (const n of notesRes.data ?? []) {
      if (!n.class_id) continue;
      noteCountByClass.set(n.class_id, (noteCountByClass.get(n.class_id) ?? 0) + 1);
    }

    const today = new Date().toISOString().slice(0, 10);
    const shaped: ClassSummary[] = classes.map(c => {
      const exams = examsByClass.get(c.id) ?? [];
      const upcomingExams = exams
        .filter(e => e.target_date && e.target_date >= today)
        .sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""));
      return {
        id: c.id,
        name: c.name,
        shortCode: c.short_code,
        professor: c.professor,
        term: c.term,
        color: c.color,
        emoji: c.emoji,
        position: c.position,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        examCount: exams.length,
        noteCount: noteCountByClass.get(c.id) ?? 0,
        nextExamDate: upcomingExams[0]?.target_date ?? null,
        // Display % aggregate is computed in the detail page where we
        // already pull mastery_progress; keeping the index payload light.
        overallDisplayPct: 0,
      };
    });

    return NextResponse.json({ classes: shaped });
  } catch (e) {
    console.error("[classes GET]", e);
    return NextResponse.json({ error: "Couldn't load your classes." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — create
// ─────────────────────────────────────────────────────────────────────────────
interface CreateBody {
  name: string;
  shortCode?: string | null;
  professor?: string | null;
  term?: string | null;
  color?: string | null;
  emoji?: string | null;
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: CreateBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = String(body.name ?? "").trim().slice(0, 80);
  if (name.length < 2) {
    return NextResponse.json({ error: "Class name must be at least 2 characters." }, { status: 400 });
  }

  // Sanitize optional fields. Hex color must match the strict pattern; fall back to gold otherwise.
  const color = body.color && HEX_COLOR_RE.test(body.color) ? body.color : "#FFD700";
  const emoji = body.emoji ? String(body.emoji).slice(0, 4) : null;
  const shortCode = body.shortCode ? String(body.shortCode).trim().slice(0, 24) : null;
  const professor = body.professor ? String(body.professor).trim().slice(0, 80) : null;
  const term = body.term ? String(body.term).trim().slice(0, 32) : null;

  // Place the new class at the end of the user's list.
  const { data: maxPosRow } = await supabaseAdmin
    .from("classes")
    .select("position")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((maxPosRow as { position?: number } | null)?.position ?? -1) + 1;

  try {
    const { data, error } = await supabaseAdmin
      .from("classes")
      .insert({
        user_id: userId,
        name,
        short_code: shortCode,
        professor,
        term,
        color,
        emoji,
        position,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[classes POST] insert:", error?.message);
      return NextResponse.json({ error: "Couldn't create class." }, { status: 500 });
    }

    return NextResponse.json({ classId: data.id });
  } catch (e) {
    console.error("[classes POST]", e);
    return NextResponse.json({ error: "Couldn't create class." }, { status: 500 });
  }
}
