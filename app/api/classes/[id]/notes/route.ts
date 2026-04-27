import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { bumpClassStreak } from "@/lib/class-streaks";
import { generateFlashcardsForNote } from "@/lib/class-flashcards";

/**
 * GET  /api/classes/[id]/notes  — list active notes for a class
 * POST /api/classes/[id]/notes  — create a note inside a class
 *
 * Notes are pinned-first, then by updated_at DESC. Soft-deleted (archived)
 * rows are excluded.
 */

type RouteCtx = { params: { id: string } };

interface NoteRow {
  id: string;
  title: string | null;
  body: string;
  source: string;
  pinned: boolean;
  ai_topics: string[] | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_BODY_BYTES = 50 * 1024;   // 50 KB — generous for pasted lectures
const MAX_TITLE_CHARS = 120;

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  // Ownership check on the class
  const { data: cls } = await supabaseAdmin
    .from("classes")
    .select("user_id")
    .eq("id", classId)
    .single();
  if (!cls || cls.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_notes")
    .select("id, title, body, source, pinned, ai_topics, ai_summary, created_at, updated_at")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[notes GET]", error.message);
    return NextResponse.json({ error: "Couldn't load notes." }, { status: 500 });
  }

  return NextResponse.json({ notes: shapeNotes(data ?? []) });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — create
// ─────────────────────────────────────────────────────────────────────────────
interface CreateBody {
  title?: string | null;
  body: string;
  source?: "manual" | "quick" | "paste" | "upload";
  pinned?: boolean;
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  let body: CreateBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const noteBody = String(body.body ?? "").trim();
  if (noteBody.length < 1) {
    return NextResponse.json({ error: "Note can't be empty." }, { status: 400 });
  }
  if (noteBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Note is too long (max 50 KB)." }, { status: 413 });
  }

  const title = body.title ? String(body.title).trim().slice(0, MAX_TITLE_CHARS) : null;
  const source = body.source && ["manual", "quick", "paste", "upload"].includes(body.source)
    ? body.source : "manual";
  const pinned = !!body.pinned;

  // Ownership check + insert
  const { data: cls } = await supabaseAdmin
    .from("classes")
    .select("user_id")
    .eq("id", classId)
    .single();
  if (!cls || cls.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_notes")
    .insert({
      user_id: userId,
      class_id: classId,
      title,
      body: noteBody,
      source,
      pinned,
    })
    .select("id, title, body, source, pinned, ai_topics, ai_summary, created_at, updated_at")
    .single();

  if (error || !data) {
    console.error("[notes POST]", error?.message);
    return NextResponse.json({ error: "Couldn't save note." }, { status: 500 });
  }

  // Best-effort: bump the per-class streak. Never blocks the response.
  void bumpClassStreak(userId, classId);

  // Best-effort: generate AI flashcards from this note in the background.
  // Skips short notes internally (<80 chars). Failures are logged, never
  // surface to the user — the note save has already succeeded.
  void generateFlashcardsForNote({
    userId,
    classId,
    noteId: data.id,
    noteBody: noteBody,
  });

  return NextResponse.json({ note: shapeNotes([data])[0] });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function shapeNotes(rows: NoteRow[]) {
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    body: r.body,
    source: r.source,
    pinned: r.pinned,
    aiTopics: r.ai_topics,
    aiSummary: r.ai_summary,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
