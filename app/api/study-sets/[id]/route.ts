import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isMissingSchema } from "@/lib/review-hub";
import {
  isUuid,
  normalizeDescription,
  normalizeSubject,
  normalizeTitle,
  STUDY_SETS_NOT_READY_MSG,
} from "@/lib/study-sets";

export const dynamic = "force-dynamic";

/**
 * GET    /api/study-sets/[id] — deck + its cards + due count (owner-only v1;
 *          public reads are the Library feature's job)
 * PATCH  /api/study-sets/[id] — edit title / description / subject
 * DELETE /api/study-sets/[id] — delete the deck (cards cascade in the DB)
 *
 * FAIL-SOFT: missing schema (HELD 20260702130000 unapplied) returns 503
 * { notReady: true } with honest copy. Not-found and not-owner are collapsed
 * into one 404 so existence never leaks.
 */

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const { data: set, error: setErr } = await supabaseAdmin
    .from("study_sets")
    .select(
      "id, title, description, subject, class_id, card_count, is_public, clone_count, created_at, updated_at",
    )
    .eq("id", params.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (setErr) {
    if (isMissingSchema(setErr)) {
      return NextResponse.json(
        { error: STUDY_SETS_NOT_READY_MSG, notReady: true },
        { status: 503 },
      );
    }
    console.error("[study-sets/[id] GET]", setErr.message);
    return NextResponse.json({ error: "Couldn't load the deck." }, { status: 500 });
  }
  if (!set) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from("study_cards")
    .select(
      "id, type, front, back, options, correct_index, ease, interval_days, next_due_at, review_count, correct_count, created_at",
    )
    .eq("set_id", set.id)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (cardsErr) {
    console.error("[study-sets/[id] GET cards]", cardsErr.message);
    return NextResponse.json({ error: "Couldn't load the deck." }, { status: 500 });
  }

  const nowMs = Date.now();
  const dueCount = (cards ?? []).filter((c) => {
    const t = new Date(String(c.next_due_at)).getTime();
    return !Number.isNaN(t) && t <= nowMs;
  }).length;

  return NextResponse.json({ set, cards: cards ?? [], dueCount });
}

interface PatchBody {
  title?: unknown;
  description?: unknown;
  subject?: unknown;
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (body.title !== undefined) {
    const title = normalizeTitle(body.title);
    if (!title) {
      return NextResponse.json(
        { error: "The title must be 1 to 80 characters." },
        { status: 400 },
      );
    }
    updates.title = title;
  }
  if (body.description !== undefined) {
    updates.description = normalizeDescription(body.description);
  }
  if (body.subject !== undefined) {
    updates.subject = normalizeSubject(body.subject);
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  // Post-publish edit rule (moderation-gate integrity, reviewer blocker):
  // publishing moderates content ONCE, so any content edit on a PUBLIC set
  // auto-unpublishes it. Republishing re-runs moderation, closing the
  // publish-clean-then-edit-slurs bypass on a minor-facing library.
  const contentChanged =
    body.title !== undefined || body.description !== undefined;
  let unpublished = false;

  const { data: updated, error } = await supabaseAdmin
    .from("study_sets")
    .update(updates)
    .eq("id", params.id)
    .eq("user_id", userId)
    .select(
      "id, title, description, subject, class_id, card_count, is_public, clone_count, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json(
        { error: STUDY_SETS_NOT_READY_MSG, notReady: true },
        { status: 503 },
      );
    }
    console.error("[study-sets/[id] PATCH]", error.message);
    return NextResponse.json({ error: "Couldn't update the deck." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  if (contentChanged && updated.is_public) {
    const { data: unpub } = await supabaseAdmin
      .from("study_sets")
      .update({ is_public: false, published_at: null })
      .eq("id", params.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (unpub) {
      unpublished = true;
      updated.is_public = false;
    }
  }

  return NextResponse.json({ set: updated, unpublished });
}

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("study_sets")
    .delete()
    .eq("id", params.id)
    .eq("user_id", userId);

  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json(
        { error: STUDY_SETS_NOT_READY_MSG, notReady: true },
        { status: 503 },
      );
    }
    console.error("[study-sets/[id] DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't delete the deck." }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
