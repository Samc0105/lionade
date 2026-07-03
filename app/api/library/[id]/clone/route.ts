// POST /api/library/[id]/clone — copy a public study set (plus all cards) into
// the caller's own sets. Free: no Fang cost, no Fang reward (unlike vocab
// clone) — this keeps the route entirely off the ledger and therefore fully
// functional before ANY money migration lands.
//
// Rules (mirrors app/api/vocab/banks/[id]/clone semantics):
//   - source must exist and be is_public
//   - no self-clone
//   - ONE clone per user per source set — checked here AND race-safe via the
//     partial unique index idx_study_sets_one_clone_per_source (23505 on the
//     losing insert resolves to the existing clone, idempotent response)
//   - clones land PRIVATE (is_public=false, cloned_from=source) with fresh
//     SM-2 card state — lib/library/cards.ts omits SR state columns so the
//     schema's fresh-card defaults apply (ease 2.5, due now, counts 0)
//   - source clone_count incremented via a small CAS loop (non-financial;
//     best-effort on contention)
//
// FAIL-SOFT (HELD migrations unapplied): 42P01/42703 anywhere ->
// 503 { unavailable: true } with honest copy. Nothing 500s.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  isMissingLibrarySchema,
  libraryUnavailableResponse,
} from "@/lib/library/schema-guard";
import {
  STUDY_SETS_TABLE,
  STUDY_SET_CARDS_TABLE,
} from "@/lib/library/constants";
import { buildClonedCardRow, type CardRow } from "@/lib/library/cards";

/**
 * Set-row columns never copied to a clone: identity, lineage, library state,
 * and class_id (the SOURCE owner's class linkage — a clone must not attach
 * itself to someone else's class).
 */
const SET_SYSTEM_FIELDS = new Set([
  "id",
  "user_id",
  "created_at",
  "updated_at",
  "is_public",
  "published_at",
  "clone_count",
  "cloned_from",
  "class_id",
]);

const CARD_INSERT_CHUNK = 500;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const sourceId = params.id;
  if (!sourceId || typeof sourceId !== "string") {
    return NextResponse.json({ error: "Missing set id" }, { status: 400 });
  }

  // ── Source set ─────────────────────────────────────────────────────────
  const { data: source, error: sourceErr } = await supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceErr) {
    if (isMissingLibrarySchema(sourceErr)) return libraryUnavailableResponse();
    console.error("[library/clone] source lookup", sourceErr.message);
    return NextResponse.json({ error: "Couldn't clone the set." }, { status: 500 });
  }
  if (!source) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const src = source as CardRow & { id: string; user_id: string };
  if (src.is_public !== true) {
    return NextResponse.json({ error: "This set isn't public anymore." }, { status: 403 });
  }
  if (src.user_id === userId) {
    return NextResponse.json({ error: "You can't clone your own set." }, { status: 400 });
  }

  // ── One clone per user per source (fast path; index backs the race) ────
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("cloned_from", sourceId)
    .limit(1);
  if (existingErr) {
    if (isMissingLibrarySchema(existingErr)) return libraryUnavailableResponse();
    console.error("[library/clone] dedupe check", existingErr.message);
    return NextResponse.json({ error: "Couldn't clone the set." }, { status: 500 });
  }
  if (existing && existing.length > 0) {
    return NextResponse.json({ setId: existing[0].id, alreadyCloned: true, cardCount: 0 });
  }

  // ── Insert the new set (content columns copied, library state reset) ───
  const newSetRow: CardRow = {};
  for (const [key, value] of Object.entries(src)) {
    if (SET_SYSTEM_FIELDS.has(key)) continue;
    newSetRow[key] = value;
  }
  newSetRow.user_id = userId;
  newSetRow.is_public = false;
  newSetRow.cloned_from = sourceId;

  const { data: created, error: createErr } = await supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .insert(newSetRow)
    .select("id")
    .single();
  if (createErr || !created) {
    if (createErr?.code === "23505") {
      // Lost a double-tap race to ourselves — resolve to the existing clone.
      const { data: raced } = await supabaseAdmin
        .from(STUDY_SETS_TABLE)
        .select("id")
        .eq("user_id", userId)
        .eq("cloned_from", sourceId)
        .limit(1);
      if (raced && raced.length > 0) {
        return NextResponse.json({ setId: raced[0].id, alreadyCloned: true, cardCount: 0 });
      }
    }
    if (createErr && isMissingLibrarySchema(createErr)) return libraryUnavailableResponse();
    console.error("[library/clone] set insert", createErr?.message ?? "no row");
    return NextResponse.json({ error: "Couldn't clone the set." }, { status: 500 });
  }
  const newSetId = created.id as string;

  // ── Copy cards with fresh SM-2 state ────────────────────────────────────
  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from(STUDY_SET_CARDS_TABLE)
    .select("*")
    .eq("set_id", sourceId);
  if (cardsErr) {
    console.error("[library/clone] cards read", cardsErr.message);
    await supabaseAdmin.from(STUDY_SETS_TABLE).delete().eq("id", newSetId).eq("user_id", userId);
    if (isMissingLibrarySchema(cardsErr)) return libraryUnavailableResponse();
    return NextResponse.json({ error: "Couldn't clone the set." }, { status: 500 });
  }

  const cardRows = (cards ?? []) as CardRow[];
  const freshCards = cardRows.map((row) => buildClonedCardRow(row, newSetId, userId));
  for (let i = 0; i < freshCards.length; i += CARD_INSERT_CHUNK) {
    const chunk = freshCards.slice(i, i + CARD_INSERT_CHUNK);
    const { error: insertErr } = await supabaseAdmin
      .from(STUDY_SET_CARDS_TABLE)
      .insert(chunk);
    if (insertErr) {
      console.error("[library/clone] cards insert", insertErr.message);
      // Unwind: cards first (in case there's no FK cascade), then the set.
      await supabaseAdmin.from(STUDY_SET_CARDS_TABLE).delete().eq("set_id", newSetId);
      await supabaseAdmin.from(STUDY_SETS_TABLE).delete().eq("id", newSetId).eq("user_id", userId);
      return NextResponse.json({ error: "Couldn't clone the set." }, { status: 500 });
    }
  }

  // ── Bump the source clone_count (CAS, best-effort, non-financial) ───────
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: fresh, error: readErr } = await supabaseAdmin
      .from(STUDY_SETS_TABLE)
      .select("clone_count")
      .eq("id", sourceId)
      .maybeSingle();
    if (readErr || !fresh) break;
    const before = (fresh.clone_count as number | null) ?? 0;
    const { data: bumped, error: bumpErr } = await supabaseAdmin
      .from(STUDY_SETS_TABLE)
      .update({ clone_count: before + 1 })
      .eq("id", sourceId)
      .eq("clone_count", before)
      .select("id");
    if (bumpErr) {
      console.error("[library/clone] clone_count bump", bumpErr.message);
      break;
    }
    if (bumped && bumped.length > 0) break; // CAS won
    // CAS lost to a concurrent clone — re-read once and retry.
  }

  return NextResponse.json({
    setId: newSetId,
    alreadyCloned: false,
    cardCount: freshCards.length,
  });
}
