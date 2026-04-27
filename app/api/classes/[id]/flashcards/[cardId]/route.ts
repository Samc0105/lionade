import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { applyRating, type FlashcardRating } from "@/lib/class-flashcards";

/**
 * PATCH  /api/classes/[id]/flashcards/[cardId]  — record a review rating
 * DELETE /api/classes/[id]/flashcards/[cardId]  — soft archive
 *
 * Auth + ownership are enforced before any read or write. The class id in
 * the URL must match the card's class_id (otherwise we 404 to avoid leaking
 * existence across classes).
 */

type RouteCtx = { params: { id: string; cardId: string } };

const VALID_RATINGS: ReadonlySet<FlashcardRating> = new Set<FlashcardRating>([
  "again", "hard", "good", "easy",
]);

interface CardRow {
  id: string;
  user_id: string;
  class_id: string;
  ease: string | number;
  interval_days: number;
  reviews: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — apply a rating, recompute SR state, persist
// ─────────────────────────────────────────────────────────────────────────────
interface PatchBody {
  rating?: string;
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const { id: classId, cardId } = params;

  let body: PatchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const rating = body.rating as FlashcardRating | undefined;
  if (!rating || !VALID_RATINGS.has(rating)) {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("class_flashcards")
    .select("id, user_id, class_id, ease, interval_days, reviews")
    .eq("id", cardId)
    .single();

  const card = existing as CardRow | null;
  if (!card || card.user_id !== userId || card.class_id !== classId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const next = applyRating(
    { ease: Number(card.ease), intervalDays: card.interval_days },
    rating,
  );

  const { data: updated, error } = await supabaseAdmin
    .from("class_flashcards")
    .update({
      ease: next.ease,
      interval_days: next.intervalDays,
      next_due_at: next.nextDueAt.toISOString(),
      reviews: card.reviews + 1,
    })
    .eq("id", cardId)
    .eq("user_id", userId)
    .select("id, question, answer, source, ease, interval_days, next_due_at, reviews, source_note_id, created_at, updated_at")
    .single();

  if (error || !updated) {
    console.error("[flashcards PATCH]", error?.message);
    return NextResponse.json({ error: "Couldn't update card." }, { status: 500 });
  }

  return NextResponse.json({
    card: {
      id: updated.id,
      question: updated.question,
      answer: updated.answer,
      source: updated.source,
      ease: Number(updated.ease),
      intervalDays: updated.interval_days,
      nextDueAt: updated.next_due_at,
      reviews: updated.reviews,
      sourceNoteId: updated.source_note_id,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — soft archive
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const { id: classId, cardId } = params;

  const { data: existing } = await supabaseAdmin
    .from("class_flashcards")
    .select("id, user_id, class_id")
    .eq("id", cardId)
    .single();

  if (!existing || existing.user_id !== userId || existing.class_id !== classId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("class_flashcards")
    .update({ archived: true })
    .eq("id", cardId)
    .eq("user_id", userId);

  if (error) {
    console.error("[flashcards DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't archive card." }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
