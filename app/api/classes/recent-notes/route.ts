import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/classes/recent-notes
 *
 * Returns the user's 12 most recently updated, non-archived notes across
 * all classes — joined with the class name/color/emoji so the Academia
 * hub can render rich cards in a single round-trip.
 */

interface RecentNoteRow {
  id: string;
  title: string | null;
  body: string;
  pinned: boolean;
  ai_summary: string | null;
  updated_at: string;
  classes: {
    id: string;
    name: string;
    color: string;
    emoji: string | null;
    short_code: string | null;
  } | null;
}

const LIMIT = 12;
const PREVIEW_CHARS = 180;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("class_notes")
    .select("id, title, body, pinned, ai_summary, updated_at, classes!inner(id, name, color, emoji, short_code)")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error("[recent-notes GET]", error.message);
    return NextResponse.json({ error: "Couldn't load notes." }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as RecentNoteRow[];
  const notes = rows
    .filter(r => r.classes !== null)
    .map(r => ({
      id: r.id,
      title: r.title,
      preview: (r.ai_summary ?? r.body).trim().slice(0, PREVIEW_CHARS),
      pinned: r.pinned,
      updatedAt: r.updated_at,
      classId: r.classes!.id,
      className: r.classes!.name,
      classColor: r.classes!.color,
      classEmoji: r.classes!.emoji,
      classShortCode: r.classes!.short_code,
    }));

  return NextResponse.json({ notes });
}
