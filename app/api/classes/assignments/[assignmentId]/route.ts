import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * PATCH  /api/classes/assignments/[assignmentId]  — edit title / due_date / status
 * DELETE /api/classes/assignments/[assignmentId]  — delete
 *
 * Operates on a single assignment by id. Ownership is enforced at the row
 * level: the row's user_id must equal the authed caller. We scope the
 * UPDATE/DELETE with `.eq("user_id", userId)` so even a guessed id can never
 * touch another user's row. updated_at is auto-touched by a DB trigger.
 */

type RouteCtx = { params: { assignmentId: string } };

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

function shape(r: AssignmentRow) {
  return {
    id: r.id,
    class_id: r.class_id,
    title: r.title,
    due_date: r.due_date,
    status: r.status as Status,
    created_at: r.created_at,
  };
}

/** YYYY-MM-DD only — anything else becomes null. */
function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const SELECT_COLS = "id, class_id, title, due_date, status, created_at";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — edit
// ─────────────────────────────────────────────────────────────────────────────
interface PatchBody {
  title?: string;
  due_date?: string | null;
  status?: string;
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const assignmentId = params.assignmentId;

  let body: PatchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Verify the row exists and belongs to the caller before mutating.
  const { data: existing } = await supabaseAdmin
    .from("class_assignments")
    .select("id, user_id")
    .eq("id", assignmentId)
    .single();
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 200);
    if (title.length < 1) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }
    update.title = title;
  }
  if (body.due_date !== undefined) update.due_date = parseDate(body.due_date);
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status as Status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_assignments")
    .update(update)
    .eq("id", assignmentId)
    .eq("user_id", userId)
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    console.error("[class-assignment PATCH]", error?.message);
    return NextResponse.json({ error: "Couldn't update assignment." }, { status: 500 });
  }

  return NextResponse.json({ assignment: shape(data) });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const assignmentId = params.assignmentId;

  const { error } = await supabaseAdmin
    .from("class_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("user_id", userId);

  if (error) {
    console.error("[class-assignment DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't delete assignment." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
