// POST /api/study-sets/[id]/publish — owner publishes (or unpublishes) a study
// set to the Community Library.
//
// Body: { action?: "publish" | "unpublish" }   (default "publish")
//
// PUBLISH runs lib/moderation-ugc.ts over title + description + ALL card text
// BEFORE flipping is_public — flagged content gets a 400 with honest copy and
// an audit row via logFlagged. Moderation input is chunked under moderateText's
// 4000-char truncation point and hard-capped at MAX_MODERATION_CHUNKS (input
// size cap BEFORE any outbound call). The OpenAI moderations endpoint is free
// and moderateText carries its own 4s AbortSignal.timeout.
//
// UNPUBLISH just sets is_public = false (published_at is kept as history).
//
// Re-publishing is blocked while the set sits at >= REPORT_AUTO_UNPUBLISH_THRESHOLD
// unique open reports — otherwise the auto-unpublish in the report route would
// be a one-click bypass.
//
// FAIL-SOFT (HELD migrations 20260702130000 + 20260702140000 unapplied): every
// study_sets/study_cards read fails 42P01/42703 -> 503 { unavailable: true }
// with honest copy (lib/library/schema-guard.ts). Nothing 500s.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import { moderateText, logFlagged } from "@/lib/moderation-ugc";
import {
  isMissingLibrarySchema,
  libraryUnavailableResponse,
} from "@/lib/library/schema-guard";
import {
  MODERATION_CHUNK_CHARS,
  MAX_MODERATION_CHUNKS,
  REPORT_AUTO_UNPUBLISH_THRESHOLD,
  STUDY_SETS_TABLE,
  STUDY_SET_CARDS_TABLE,
  LIBRARY_REPORTS_TABLE,
} from "@/lib/library/constants";
import { extractCardText, type CardRow } from "@/lib/library/cards";

const FLAGGED_COPY =
  "This set can't be published as written. Please review the title, description, and cards, then try again.";

/** Pack text pieces into chunks that stay under moderateText's truncation. */
function packChunks(pieces: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    // A single oversized piece gets split hard — never silently truncated.
    for (let i = 0; i < piece.length; i += MODERATION_CHUNK_CHARS) {
      const part = piece.slice(i, i + MODERATION_CHUNK_CHARS);
      if (current.length + part.length + 1 > MODERATION_CHUNK_CHARS) {
        if (current) chunks.push(current);
        current = part;
      } else {
        current = current ? `${current}\n${part}` : part;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  // Demo accounts must not put UGC in front of the whole community.
  if (isDemoUser(userId)) return demoBlockedResponse();

  const setId = params.id;
  if (!setId || typeof setId !== "string") {
    return NextResponse.json({ error: "Missing set id" }, { status: 400 });
  }

  let action: "publish" | "unpublish" = "publish";
  try {
    const body = (await req.json()) as { action?: unknown } | null;
    if (body?.action === "unpublish") action = "unpublish";
  } catch {
    // Empty/invalid body -> default "publish".
  }

  // ── Ownership + current state ─────────────────────────────────────────
  const { data: set, error: setErr } = await supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .select("id, user_id, title, description, is_public")
    .eq("id", setId)
    .maybeSingle();
  if (setErr) {
    if (isMissingLibrarySchema(setErr)) return libraryUnavailableResponse();
    console.error("[study-sets/publish] set lookup", setErr.message);
    return NextResponse.json({ error: "Couldn't update the set." }, { status: 500 });
  }
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  if (set.user_id !== userId) {
    return NextResponse.json({ error: "Only the owner can do that." }, { status: 403 });
  }

  // ── Unpublish: simple flip, keep published_at as history ──────────────
  if (action === "unpublish") {
    const { error: updErr } = await supabaseAdmin
      .from(STUDY_SETS_TABLE)
      .update({ is_public: false })
      .eq("id", setId)
      .eq("user_id", userId);
    if (updErr) {
      if (isMissingLibrarySchema(updErr)) return libraryUnavailableResponse();
      console.error("[study-sets/publish] unpublish", updErr.message);
      return NextResponse.json({ error: "Couldn't update the set." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, isPublic: false });
  }

  // ── Republish guard: reported-off sets stay off ───────────────────────
  // library_reports may not exist yet (addendum unapplied) — in that world no
  // one can HAVE reported the set, so a missing table safely reads as zero.
  const { data: reportRows, error: reportsErr } = await supabaseAdmin
    .from(LIBRARY_REPORTS_TABLE)
    .select("reporter")
    .eq("set_id", setId)
    .eq("status", "open");
  if (reportsErr && !isMissingLibrarySchema(reportsErr)) {
    console.error("[study-sets/publish] reports check", reportsErr.message);
    return NextResponse.json({ error: "Couldn't update the set." }, { status: 500 });
  }
  const uniqueReporters = new Set(
    ((reportRows ?? []) as Array<{ reporter: string }>).map((r) => r.reporter),
  ).size;
  if (uniqueReporters >= REPORT_AUTO_UNPUBLISH_THRESHOLD) {
    return NextResponse.json(
      { error: "This set was removed after community reports and can't be republished." },
      { status: 400 },
    );
  }

  // ── Gather content for moderation ─────────────────────────────────────
  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from(STUDY_SET_CARDS_TABLE)
    .select("*")
    .eq("set_id", setId);
  if (cardsErr) {
    if (isMissingLibrarySchema(cardsErr)) return libraryUnavailableResponse();
    console.error("[study-sets/publish] cards", cardsErr.message);
    return NextResponse.json({ error: "Couldn't update the set." }, { status: 500 });
  }
  const cardRows = (cards ?? []) as CardRow[];
  if (cardRows.length === 0) {
    return NextResponse.json(
      { error: "Add at least one card before publishing." },
      { status: 400 },
    );
  }

  const pieces: string[] = [];
  const title = typeof set.title === "string" ? set.title.trim() : "";
  const description = typeof set.description === "string" ? set.description.trim() : "";
  if (title) pieces.push(title);
  if (description) pieces.push(description);
  for (const row of cardRows) pieces.push(...extractCardText(row));

  const chunks = packChunks(pieces);
  if (chunks.length > MAX_MODERATION_CHUNKS) {
    // Input-size cap before spend/latency — honest refusal, not a truncated scan.
    return NextResponse.json(
      { error: "This set is too large to publish right now. Try splitting it into smaller sets." },
      { status: 400 },
    );
  }

  // ── Moderate (denylist floor + OpenAI moderations, free endpoint) ─────
  for (const chunk of chunks) {
    const verdict = await moderateText(chunk);
    if (!verdict.ok) {
      await logFlagged(userId, "study_set_publish", chunk, verdict);
      return NextResponse.json({ error: FLAGGED_COPY }, { status: 400 });
    }
  }

  // ── Flip public ────────────────────────────────────────────────────────
  const publishedAt = new Date().toISOString();
  const { error: pubErr } = await supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .update({ is_public: true, published_at: publishedAt })
    .eq("id", setId)
    .eq("user_id", userId);
  if (pubErr) {
    if (isMissingLibrarySchema(pubErr)) return libraryUnavailableResponse();
    console.error("[study-sets/publish] publish", pubErr.message);
    return NextResponse.json({ error: "Couldn't update the set." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, isPublic: true, publishedAt });
}
