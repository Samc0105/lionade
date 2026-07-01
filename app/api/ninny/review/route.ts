import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  buildReviewItem,
  isDue,
  priorityScore,
  msUntilDue,
  type WeakSpotRow,
  type ReviewItem,
} from "@/lib/weak-spot-review";

export const dynamic = "force-dynamic";

// GET /api/ninny/review?limit=15
//
// Returns the authed user's DUE weak-spot questions (spaced-repetition), newest
// misses ordered most-urgent-first, reconstructed into real MCQs where the
// original option set can be recovered from the source material, otherwise as
// flashcard-reveal items.
//
// Server-authoritative: reads via supabaseAdmin, scoped to auth.userId. The
// client never sends a user id.
//
// Fail-soft: SR columns (review_streak / review_interval_days) are optional and
// only exist if the HELD migration has been applied. We attempt to select them
// and fall back to a miss_count + last_seen_at schedule if the columns are
// absent.

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 40;

// Columns present only after the HELD SR migration. We try the rich select
// first; on a "column does not exist" error we retry with the base columns.
const BASE_COLS = "id, material_id, question_text, correct_answer, miss_count, last_seen_at";
const SR_COLS = `${BASE_COLS}, review_streak, review_interval_days`;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT));

  // 1) Read the user's wrong-answer memory. Try SR columns, fall back to base.
  let rows: WeakSpotRow[] | null = null;
  {
    const rich = await supabaseAdmin
      .from("ninny_wrong_answers")
      .select(SR_COLS)
      .eq("user_id", userId)
      .order("miss_count", { ascending: false })
      .limit(500);

    if (rich.error) {
      // Likely the SR columns don't exist yet (migration held). Retry with base.
      const base = await supabaseAdmin
        .from("ninny_wrong_answers")
        .select(BASE_COLS)
        .eq("user_id", userId)
        .order("miss_count", { ascending: false })
        .limit(500);
      if (base.error) {
        console.error("[ninny/review GET]", base.error.message);
        return NextResponse.json({ items: [], dueCount: 0, totalWeakSpots: 0, nextDueInMs: null });
      }
      rows = (base.data ?? []) as unknown as WeakSpotRow[];
    } else {
      rows = (rich.data ?? []) as unknown as WeakSpotRow[];
    }
  }

  const allRows = rows ?? [];
  if (allRows.length === 0) {
    return NextResponse.json({ items: [], dueCount: 0, totalWeakSpots: 0, nextDueInMs: null });
  }

  // 2) Split into due / not-yet-due.
  const now = Date.now();
  const dueRows = allRows.filter((r) => isDue(r, now));

  // Next-due countdown for the "all caught up" state (min over not-due rows).
  const notDue = allRows.filter((r) => !isDue(r, now));
  const nextDueInMs = notDue.length > 0
    ? Math.min(...notDue.map((r) => msUntilDue(r, now)))
    : null;

  // If nothing is strictly due, respect the spaced-repetition schedule and
  // return the caught-up state — do NOT re-drill freshly-answered items (that
  // tightened the loop below the intended spacing and made the /learn badge and
  // the /learn/review page disagree about whether anything was due).
  if (dueRows.length === 0) {
    return NextResponse.json({
      items: [],
      dueCount: 0,
      totalWeakSpots: allRows.length,
      nextDueInMs,
    });
  }

  // 3) Order most-urgent-first and take the session slice.
  const ordered = [...dueRows].sort((a, b) => priorityScore(b, now) - priorityScore(a, now));
  const slice = ordered.slice(0, limit);

  // 4) Reconstruct real MCQs by joining back to the source materials. Batch the
  //    material lookups (RLS-protected cross-read -> supabaseAdmin, scoped by the
  //    already-authenticated userId to prevent leaking another user's material).
  const materialIds = Array.from(new Set(slice.map((r) => r.material_id)));
  const materialsById = new Map<string, {
    id: string;
    title: string | null;
    multipleChoice?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
    blitz?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
  }>();

  if (materialIds.length > 0) {
    const { data: mats } = await supabaseAdmin
      .from("ninny_materials")
      .select("id, user_id, title, generated_content")
      .in("id", materialIds)
      .eq("user_id", userId); // ownership guard
    for (const m of mats ?? []) {
      const gc = (m.generated_content ?? {}) as {
        multipleChoice?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
        blitz?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
      };
      materialsById.set(m.id, {
        id: m.id,
        title: (m.title as string | null) ?? null,
        multipleChoice: Array.isArray(gc.multipleChoice) ? gc.multipleChoice : [],
        blitz: Array.isArray(gc.blitz) ? gc.blitz : [],
      });
    }
  }

  const items: ReviewItem[] = slice.map((row) =>
    buildReviewItem(row, materialsById.get(row.material_id)),
  );

  return NextResponse.json({
    items,
    dueCount: dueRows.length,
    totalWeakSpots: allRows.length,
    nextDueInMs,
  });
}
