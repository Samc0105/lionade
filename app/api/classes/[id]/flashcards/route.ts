import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/classes/[id]/flashcards
 *
 * Returns all non-archived flashcards for the (user, class), ordered by
 * `next_due_at ASC`. The client decides which subset to drill — server
 * just returns everything in priority order.
 */

type RouteCtx = { params: { id: string } };

interface CardRow {
  id: string;
  question: string;
  answer: string;
  source: string;
  ease: number;
  interval_days: number;
  next_due_at: string;
  reviews: number;
  source_note_id: string | null;
  created_at: string;
  updated_at: string;
}

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
    .from("class_flashcards")
    .select("id, question, answer, source, ease, interval_days, next_due_at, reviews, source_note_id, created_at, updated_at")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .eq("archived", false)
    .order("next_due_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[flashcards GET]", error.message);
    return NextResponse.json({ error: "Couldn't load flashcards." }, { status: 500 });
  }

  const now = Date.now();
  const cards = shapeCards(data ?? []);
  const dueCount = cards.reduce(
    (n, c) => (new Date(c.nextDueAt).getTime() <= now ? n + 1 : n),
    0,
  );

  return NextResponse.json({ cards, dueCount });
}

function shapeCards(rows: CardRow[]) {
  return rows.map(r => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    source: r.source,
    ease: Number(r.ease),
    intervalDays: r.interval_days,
    nextDueAt: r.next_due_at,
    reviews: r.reviews,
    sourceNoteId: r.source_note_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
