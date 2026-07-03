import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isMissingSchema } from "@/lib/review-hub";
import {
  isCardValidationError,
  isUuid,
  normalizeDescription,
  normalizeSubject,
  normalizeTitle,
  STUDY_SETS_NOT_READY_MSG,
  validateCardsForSave,
} from "@/lib/study-sets";

export const dynamic = "force-dynamic";

/**
 * POST /api/study-sets — save a user-trimmed deck (after the mandatory
 *   preview step on /learn/sets/new). Body:
 *   { title, description?, subject?, classId?, cards: [1..30] }
 *   card_count is RECOUNTED server-side from the rows actually inserted;
 *   the client never sets it.
 *
 * GET /api/study-sets — list MY decks (owner-only; the public Library is a
 *   separate feature). Includes a due-card count per deck for the grid.
 *
 * FAIL-SOFT: while the HELD 20260702130000 migration is unapplied, POST
 * returns 503 { notReady: true } with honest copy and GET returns
 * { sets: [], notReady: true }. Nothing 500s.
 *
 * REWARD-FREE feature — no Fangs move anywhere in study sets v1.
 */

interface SaveBody {
  title?: unknown;
  description?: unknown;
  subject?: unknown;
  classId?: unknown;
  cards?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = normalizeTitle(body.title);
  if (!title) {
    return NextResponse.json(
      { error: "Give the deck a title (1 to 80 characters)." },
      { status: 400 },
    );
  }
  const description = normalizeDescription(body.description);
  const subject = normalizeSubject(body.subject);

  const cards = validateCardsForSave(body.cards);
  if (isCardValidationError(cards)) {
    return NextResponse.json({ error: cards.error }, { status: 400 });
  }

  // Optional class link — must be a UUID and must be the caller's own class.
  let classId: string | null = null;
  if (body.classId != null && body.classId !== "") {
    if (!isUuid(body.classId)) {
      return NextResponse.json({ error: "Invalid class." }, { status: 400 });
    }
    const { data: cls } = await supabaseAdmin
      .from("classes")
      .select("id")
      .eq("id", body.classId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!cls) {
      return NextResponse.json({ error: "Invalid class." }, { status: 400 });
    }
    classId = body.classId;
  }

  // 1) Create the set shell.
  const { data: set, error: setErr } = await supabaseAdmin
    .from("study_sets")
    .insert({
      user_id: userId,
      title,
      description,
      subject,
      class_id: classId,
      card_count: 0,
    })
    .select("id")
    .single();

  if (setErr || !set) {
    if (isMissingSchema(setErr)) {
      return NextResponse.json(
        { error: STUDY_SETS_NOT_READY_MSG, notReady: true },
        { status: 503 },
      );
    }
    console.error("[study-sets POST] set insert:", setErr?.message);
    return NextResponse.json({ error: "Couldn't save the deck." }, { status: 500 });
  }

  // 2) Insert the cards.
  const nowISO = new Date().toISOString();
  const rows = cards.map((c) => ({
    set_id: set.id,
    user_id: userId,
    type: c.type,
    front: c.front,
    back: c.back,
    options: c.options,
    correct_index: c.correct_index,
    ease: 2.5,
    interval_days: null,
    next_due_at: nowISO,
    review_count: 0,
    correct_count: 0,
  }));

  const { error: cardsErr } = await supabaseAdmin.from("study_cards").insert(rows);
  if (cardsErr) {
    console.error("[study-sets POST] cards insert:", cardsErr.message);
    // Roll back the empty shell so the user's list never shows a broken deck.
    await supabaseAdmin.from("study_sets").delete().eq("id", set.id).eq("user_id", userId);
    return NextResponse.json({ error: "Couldn't save the deck's cards." }, { status: 500 });
  }

  // 3) Server recount — trust the DB, not the request payload.
  const { count } = await supabaseAdmin
    .from("study_cards")
    .select("id", { count: "exact", head: true })
    .eq("set_id", set.id);
  const cardCount = count ?? cards.length;
  await supabaseAdmin
    .from("study_sets")
    .update({ card_count: cardCount, updated_at: new Date().toISOString() })
    .eq("id", set.id)
    .eq("user_id", userId);

  return NextResponse.json(
    { set: { id: set.id, title, cardCount } },
    { status: 201 },
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("study_sets")
    .select(
      "id, title, description, subject, class_id, card_count, is_public, clone_count, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json({ sets: [], notReady: true });
    }
    console.error("[study-sets GET]", error.message);
    return NextResponse.json({ error: "Couldn't load your decks." }, { status: 500 });
  }

  // Due-card counts per deck (best-effort; the grid hides the badge on miss).
  const dueBySet = new Map<string, number>();
  try {
    const { data: due } = await supabaseAdmin
      .from("study_cards")
      .select("set_id")
      .eq("user_id", userId)
      .lte("next_due_at", new Date().toISOString())
      .limit(2000);
    for (const row of due ?? []) {
      const k = String(row.set_id);
      dueBySet.set(k, (dueBySet.get(k) ?? 0) + 1);
    }
  } catch {
    // best-effort only
  }

  return NextResponse.json({
    sets: (data ?? []).map((s) => ({
      ...s,
      dueCount: dueBySet.get(String(s.id)) ?? 0,
    })),
    notReady: false,
  });
}
