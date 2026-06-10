import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET  /api/classes/[id]/assignments  — list a class's assignments
 * POST /api/classes/[id]/assignments  — create one
 *
 * Assignments are lightweight, dateable to-dos owned by a user + class. They
 * back both the per-class assignment board and the unified Academia agenda
 * feed (see /api/academia/agenda). Ownership of the parent class is verified
 * on every call; the caller's user_id always comes from requireAuth, never
 * the body.
 */

type RouteCtx = { params: { id: string } };

const VALID_STATUS = ["todo", "doing", "done"] as const;
type Status = (typeof VALID_STATUS)[number];

interface AssignmentRow {
  id: string;
  class_id: string;
  title: string;
  due_date: string | null;
  status: string;
  created_at: string;
}

interface ShapedAssignment {
  id: string;
  class_id: string;
  title: string;
  due_date: string | null;
  status: Status;
  created_at: string;
}

function shape(r: AssignmentRow): ShapedAssignment {
  return {
    id: r.id,
    class_id: r.class_id,
    title: r.title,
    due_date: r.due_date,
    status: r.status as Status,
    created_at: r.created_at,
  };
}

/** YYYY-MM-DD only — anything else becomes null. Keeps the DATE column clean. */
function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function verifyClassOwnership(classId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("classes")
    .select("user_id, archived")
    .eq("id", classId)
    .single();
  return !!data && data.user_id === userId && !data.archived;
}

const SELECT_COLS = "id, class_id, title, due_date, status, created_at";

// ─────────────────────────────────────────────────────────────────────────────
// GET — list
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  if (!(await verifyClassOwnership(classId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_assignments")
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .eq("class_id", classId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[class-assignments GET]", error.message);
    return NextResponse.json({ error: "Couldn't load assignments." }, { status: 500 });
  }

  return NextResponse.json({ assignments: (data ?? []).map(shape) });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — create
// ─────────────────────────────────────────────────────────────────────────────
interface CreateBody {
  title?: string;
  due_date?: string | null;
  status?: string;
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  let body: CreateBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!(await verifyClassOwnership(classId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const title = String(body.title ?? "").trim().slice(0, 200);
  if (title.length < 1) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const status: Status =
    body.status && VALID_STATUS.includes(body.status as Status)
      ? (body.status as Status)
      : "todo";

  const dueDate = parseDate(body.due_date);

  const { data, error } = await supabaseAdmin
    .from("class_assignments")
    .insert({
      user_id: userId,
      class_id: classId,
      title,
      due_date: dueDate,
      status,
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    console.error("[class-assignments POST]", error?.message);
    return NextResponse.json({ error: "Couldn't save assignment." }, { status: 500 });
  }

  return NextResponse.json({ assignment: shape(data) }, { status: 201 });
}
