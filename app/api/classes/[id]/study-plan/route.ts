import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET  /api/classes/[id]/study-plan  — propose a study schedule (NOT saved)
 * POST /api/classes/[id]/study-plan  — save proposed blocks as assignments
 *
 * ZERO AI. This is pure data math, no OpenAI / Anthropic calls.
 *
 * CONCEPT: a "study block" is just a `class_assignments` row titled
 * "Study: <topic>" with status 'todo' and due_date = the study day. Because the
 * Academia calendar, "This Week" agenda, and assignment tracker all already read
 * from class_assignments, saving these blocks makes them show up everywhere with
 * zero changes to those surfaces.
 *
 * GET only PROPOSES blocks (math over the soonest future exam's subtopic
 * mastery); it persists nothing. The UI shows the proposal, the user confirms,
 * then POST bulk-inserts the chosen blocks.
 *
 * Ownership of the parent class is verified on every call. The caller's user_id
 * always comes from requireAuth, never the request body.
 */

type RouteCtx = { params: { id: string } };

// Hard ceiling on a generated plan so a far-off exam can't spawn hundreds of
// rows. The schedule front-loads the weakest topics, so the first 21 days carry
// the most value anyway.
const MAX_BLOCKS = 21;
// POST accepts a slightly larger cap than GET produces, leaving headroom for a
// user who hand-edits / adds a few rows before saving.
const MAX_SAVE_BLOCKS = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD validator. Anything else returns null. */
function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  return DATE_RE.test(s) ? s : null;
}

async function verifyClassOwnership(classId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("classes")
    .select("user_id, archived")
    .eq("id", classId)
    .single();
  return !!data && data.user_id === userId && !data.archived;
}

/** Today as YYYY-MM-DD (UTC), matching how DATE columns compare elsewhere. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Inclusive list of YYYY-MM-DD strings from `start` to `end`. Returns [] when
 * start is after end. Iterates in UTC to avoid DST drift on day math.
 */
function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const startMs = Date.parse(start + "T00:00:00Z");
  const endMs = Date.parse(end + "T00:00:00Z");
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) return out;
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

interface StudyBlock {
  date: string;
  title: string;
  subtopicId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — propose (not saved)
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  if (!(await verifyClassOwnership(classId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const today = todayStr();

    // Soonest FUTURE exam (target_date today-or-later) for this class.
    const { data: exams, error: examErr } = await supabaseAdmin
      .from("user_exams")
      .select("id, title, target_date")
      .eq("user_id", userId)
      .eq("class_id", classId)
      .eq("archived", false)
      .not("target_date", "is", null)
      .gte("target_date", today)
      .order("target_date", { ascending: true })
      .limit(1);

    if (examErr) {
      console.error("[study-plan GET]", examErr.message);
      return NextResponse.json({ error: "Couldn't build a study plan." }, { status: 500 });
    }

    const exam = exams?.[0];
    if (!exam || !exam.target_date) {
      return NextResponse.json({ exam: null, blocks: [] });
    }

    // Study window: tomorrow through the day BEFORE the exam, inclusive. The
    // exam day itself is left clear (it's exam day, not a study day).
    const tomorrowMs = Date.parse(today + "T00:00:00Z") + 86_400_000;
    const tomorrow = new Date(tomorrowMs).toISOString().slice(0, 10);
    const dayBeforeExamMs = Date.parse(exam.target_date + "T00:00:00Z") - 86_400_000;
    const dayBeforeExam = new Date(dayBeforeExamMs).toISOString().slice(0, 10);

    const days = dateRange(tomorrow, dayBeforeExam).slice(0, MAX_BLOCKS);

    // No usable study days (exam is today or tomorrow) — nothing to schedule.
    if (days.length === 0) {
      return NextResponse.json({
        exam: { id: exam.id, title: exam.title, targetDate: exam.target_date },
        blocks: [],
      });
    }

    // Pull subtopics + this user's progress, then order weakest-first.
    const [subsRes, progRes] = await Promise.all([
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, name, display_order")
        .eq("user_exam_id", exam.id),
      supabaseAdmin
        .from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts")
        .eq("user_id", userId),
    ]);

    if (subsRes.error) {
      console.error("[study-plan GET]", subsRes.error.message);
      return NextResponse.json({ error: "Couldn't build a study plan." }, { status: 500 });
    }

    const progMap = new Map(
      (progRes.data ?? []).map(p => [p.subtopic_id, p]),
    );

    // Score each subtopic. No progress row => treated as untouched: BKT prior
    // 0.10, zero attempts, so brand-new topics sort to the very front.
    type Scored = {
      id: string;
      name: string;
      pMastery: number;
      attempts: number;
      order: number;
    };
    const scored: Scored[] = (subsRes.data ?? []).map(s => {
      const p = progMap.get(s.id);
      return {
        id: s.id,
        name: s.name,
        pMastery: p?.p_mastery ?? 0.10,
        attempts: p?.attempts ?? 0,
        order: s.display_order ?? 0,
      };
    });

    // Weakest first: lowest p_mastery, then fewest attempts, then exam order as
    // a stable tiebreak.
    scored.sort((a, b) => {
      if (a.pMastery !== b.pMastery) return a.pMastery - b.pMastery;
      if (a.attempts !== b.attempts) return a.attempts - b.attempts;
      return a.order - b.order;
    });

    const blocks: StudyBlock[] = [];

    if (scored.length === 0) {
      // Exam has no subtopics — still give one generic block per day.
      for (const date of days) {
        blocks.push({ date, title: `Study: ${exam.title}`, subtopicId: null });
      }
    } else {
      // Distribute weakest-first across the days, cycling the weakest topics so
      // every day has a block. day i gets topic (i mod count), which naturally:
      //   - packs the weakest topics earliest when topics > days, and
      //   - cycles back to the weakest first when days > topics.
      const n = scored.length;
      for (let i = 0; i < days.length; i++) {
        const topic = scored[i % n];
        const name = topic.name?.trim();
        blocks.push({
          date: days[i],
          title: name ? `Study: ${name}` : `Study: ${exam.title}`,
          subtopicId: topic.id,
        });
      }
    }

    return NextResponse.json({
      exam: { id: exam.id, title: exam.title, targetDate: exam.target_date },
      blocks,
    });
  } catch (e) {
    console.error("[study-plan GET]", e);
    return NextResponse.json({ error: "Couldn't build a study plan." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — save proposed blocks as class_assignments rows
// ─────────────────────────────────────────────────────────────────────────────
interface SaveBody {
  blocks?: Array<{ date?: unknown; title?: unknown }>;
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  let body: SaveBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!(await verifyClassOwnership(classId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rawBlocks = Array.isArray(body.blocks) ? body.blocks : [];

  // Build clean rows. Invalid blocks (bad date, empty title) are skipped rather
  // than 500'd, so one malformed row never sinks an otherwise-good batch.
  const rows = rawBlocks
    .slice(0, MAX_SAVE_BLOCKS)
    .map(b => {
      const date = parseDate(b?.date);
      const title = String(b?.title ?? "").trim().slice(0, 200);
      if (!date || title.length < 1) return null;
      return {
        user_id: userId,
        class_id: classId,
        title,
        due_date: date,
        status: "todo" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ created: 0 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_assignments")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("[study-plan POST]", error.message);
    return NextResponse.json({ error: "Couldn't save the study plan." }, { status: 500 });
  }

  return NextResponse.json({ created: data?.length ?? 0 }, { status: 201 });
}
