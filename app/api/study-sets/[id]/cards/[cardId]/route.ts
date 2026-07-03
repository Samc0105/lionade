import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isMissingSchema } from "@/lib/review-hub";
import {
  isUuid,
  STUDY_CARD_OPTION_MAX,
  STUDY_CARD_TEXT_MAX,
  STUDY_SETS_NOT_READY_MSG,
} from "@/lib/study-sets";

export const dynamic = "force-dynamic";

/**
 * PATCH  /api/study-sets/[id]/cards/[cardId] — edit a card's content
 * DELETE /api/study-sets/[id]/cards/[cardId] — remove a card (recounts the set)
 *
 * Ownership: the card must belong to the caller AND to the set in the URL
 * (mismatches 404 so existence never leaks across decks). SM-2 state is NOT
 * editable here — grading lives in /api/study-sets/cards/[cardId]/review.
 */

type RouteCtx = { params: { id: string; cardId: string } };

interface CardRow {
  id: string;
  user_id: string;
  set_id: string;
  type: "flashcard" | "mcq";
}

async function loadOwnedCard(
  userId: string,
  setId: string,
  cardId: string,
): Promise<CardRow | { notReady: true } | null> {
  const { data, error } = await supabaseAdmin
    .from("study_cards")
    .select("id, user_id, set_id, type")
    .eq("id", cardId)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { notReady: true };
    console.error("[study-sets card load]", error.message);
    return null;
  }
  const card = data as CardRow | null;
  if (!card || card.user_id !== userId || card.set_id !== setId) return null;
  return card;
}

function isNotReady(v: unknown): v is { notReady: true } {
  return typeof v === "object" && v !== null && "notReady" in (v as object);
}

async function recountSet(userId: string, setId: string): Promise<void> {
  const { count } = await supabaseAdmin
    .from("study_cards")
    .select("id", { count: "exact", head: true })
    .eq("set_id", setId);
  await supabaseAdmin
    .from("study_sets")
    .update({ card_count: count ?? 0, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", userId);
}

/**
 * Post-publish edit rule (moderation-gate integrity, reviewer blocker):
 * publish moderates content ONCE, so any card content change on a PUBLIC set
 * auto-unpublishes it. Republishing re-runs moderation, closing the
 * publish-clean-then-edit bypass. Returns true when the set was unpublished.
 */
async function unpublishIfPublic(userId: string, setId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("study_sets")
    .update({ is_public: false, published_at: null })
    .eq("id", setId)
    .eq("user_id", userId)
    .eq("is_public", true)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

interface PatchBody {
  front?: unknown;
  back?: unknown;
  options?: unknown;
  correct_index?: unknown;
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!isUuid(params.id) || !isUuid(params.cardId)) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const card = await loadOwnedCard(userId, params.id, params.cardId);
  if (isNotReady(card)) {
    return NextResponse.json(
      { error: STUDY_SETS_NOT_READY_MSG, notReady: true },
      { status: 503 },
    );
  }
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if (body.front !== undefined) {
    const front = typeof body.front === "string" ? body.front.trim() : "";
    if (front.length < 1 || front.length > STUDY_CARD_TEXT_MAX) {
      return NextResponse.json(
        { error: `The front must be 1 to ${STUDY_CARD_TEXT_MAX} characters.` },
        { status: 400 },
      );
    }
    updates.front = front;
  }
  if (body.back !== undefined) {
    const back = typeof body.back === "string" ? body.back.trim() : "";
    if (back.length < 1 || back.length > STUDY_CARD_TEXT_MAX) {
      return NextResponse.json(
        { error: `The back must be 1 to ${STUDY_CARD_TEXT_MAX} characters.` },
        { status: 400 },
      );
    }
    updates.back = back;
  }
  // Options / correct_index only make sense on mcq cards; ignored otherwise
  // so a stale client can never strip an mcq's shape (DB CHECK backs this up).
  if (card.type === "mcq") {
    if (body.options !== undefined) {
      const options = Array.isArray(body.options) ? body.options : null;
      if (
        !options ||
        options.length !== 4 ||
        !options.every(
          (o) =>
            typeof o === "string" &&
            o.trim().length > 0 &&
            o.trim().length <= STUDY_CARD_OPTION_MAX,
        )
      ) {
        return NextResponse.json(
          { error: "Multiple choice cards need exactly 4 non-empty options." },
          { status: 400 },
        );
      }
      updates.options = (options as string[]).map((o) => o.trim());
    }
    if (body.correct_index !== undefined) {
      const ci = body.correct_index;
      if (typeof ci !== "number" || !Number.isInteger(ci) || ci < 0 || ci > 3) {
        return NextResponse.json(
          { error: "Pick which option is correct." },
          { status: 400 },
        );
      }
      updates.correct_index = ci;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from("study_cards")
    .update(updates)
    .eq("id", params.cardId)
    .eq("user_id", userId)
    .select(
      "id, type, front, back, options, correct_index, ease, interval_days, next_due_at, review_count, correct_count, created_at",
    )
    .maybeSingle();

  if (error || !updated) {
    console.error("[study-sets card PATCH]", error?.message);
    return NextResponse.json({ error: "Couldn't update the card." }, { status: 500 });
  }

  // Editing content touches the deck — bump its updated_at (best-effort).
  await supabaseAdmin
    .from("study_sets")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", userId);

  const unpublished = await unpublishIfPublic(userId, params.id);

  return NextResponse.json({ card: updated, unpublished });
}

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!isUuid(params.id) || !isUuid(params.cardId)) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const card = await loadOwnedCard(userId, params.id, params.cardId);
  if (isNotReady(card)) {
    return NextResponse.json(
      { error: STUDY_SETS_NOT_READY_MSG, notReady: true },
      { status: 503 },
    );
  }
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("study_cards")
    .delete()
    .eq("id", params.cardId)
    .eq("user_id", userId);

  if (error) {
    console.error("[study-sets card DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't delete the card." }, { status: 500 });
  }

  await recountSet(userId, params.id);

  // A card removal is a content change; a published set must not silently
  // diverge from what moderation approved (and must never sit public with
  // zero cards).
  const unpublished = await unpublishIfPublic(userId, params.id);

  return NextResponse.json({ ok: true, unpublished });
}
