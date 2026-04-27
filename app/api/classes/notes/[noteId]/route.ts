import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * PATCH  /api/classes/notes/[noteId]  — edit body / title / pin / move-to-class
 * DELETE /api/classes/notes/[noteId]  — soft archive
 *
 * Move-to-class: client passes `classId: <uuid|null>`. Useful for the
 * quick-note shortcut's "wrong class? undo" affordance + manual filing
 * of unfiled notes.
 */

type RouteCtx = { params: { noteId: string } };

const MAX_BODY_BYTES = 50 * 1024;
const MAX_TITLE_CHARS = 120;

interface PatchBody {
  title?: string | null;
  body?: string;
  pinned?: boolean;
  classId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const noteId = params.noteId;

  let body: PatchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Verify ownership
  const { data: existing } = await supabaseAdmin
    .from("class_notes")
    .select("id, user_id")
    .eq("id", noteId)
    .single();
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (body.body !== undefined) {
    const next = String(body.body).trim();
    if (next.length < 1) return NextResponse.json({ error: "Note can't be empty." }, { status: 400 });
    if (next.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Note is too long." }, { status: 413 });
    update.body = next;
  }

  if (body.title !== undefined) {
    update.title = body.title ? String(body.title).trim().slice(0, MAX_TITLE_CHARS) : null;
  }

  if (typeof body.pinned === "boolean") update.pinned = body.pinned;

  // classId reassignment: null = unfile, uuid = move. Verify the target class
  // belongs to the same user.
  if (body.classId !== undefined) {
    if (body.classId === null) {
      update.class_id = null;
    } else {
      const { data: cls } = await supabaseAdmin
        .from("classes")
        .select("user_id")
        .eq("id", body.classId)
        .single();
      if (!cls || cls.user_id !== userId) {
        return NextResponse.json({ error: "Class not found" }, { status: 404 });
      }
      update.class_id = body.classId;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const { error } = await supabaseAdmin
    .from("class_notes")
    .update(update)
    .eq("id", noteId)
    .eq("user_id", userId);

  if (error) {
    console.error("[notes PATCH]", error.message);
    return NextResponse.json({ error: "Couldn't update note." }, { status: 500 });
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
  const noteId = params.noteId;

  const { error } = await supabaseAdmin
    .from("class_notes")
    .update({ archived: true })
    .eq("id", noteId)
    .eq("user_id", userId);

  if (error) {
    console.error("[notes DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't archive note." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
