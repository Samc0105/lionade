import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  fetchClassCardQueue,
  fetchRetention7d,
  fetchStudySetQueue,
  fetchVocabQueue,
  fetchWeakSpotQueue,
  interleaveQueues,
  weakSpotToHubItem,
  type HubSourceResult,
} from "@/lib/review-hub";

export const dynamic = "force-dynamic";

// GET /api/review/queue?limit=30[&source=study_set][&set=<uuid>]
//
// The unified Review Hub queue: merges DUE items from the four
// spaced-repetition systems (weak spots, vocab words, class flashcards,
// study set cards) into one interleaved session, capped at 30 items.
//
// Optional filters (used by the study-set "Review now" deep link):
//   source=<weak_spot|vocab|class_flashcard|study_set> — only that source
//   set=<uuid> — with source=study_set, only that deck's cards
// Unknown filter values are IGNORED (the full merged queue returns) so old
// links never break.
//
// READ-ONLY. Grading stays in each source's existing endpoint — the hub client
// dispatches per item:
//   weak_spot        -> POST  /api/ninny/review/grade
//   vocab            -> POST  /api/vocab/review/[id]
//   class_flashcard  -> PATCH /api/classes/[classId]/flashcards/[cardId]
//   study_set        -> POST  /api/study-sets/cards/[cardId]/review
//
// FAIL-SOFT: every source is fetched independently. A source that errors
// contributes zero items and is flagged `ok: false` in `sources` — the queue
// itself NEVER 500s over one broken source. The study_set source additionally
// reports ok:true with zero items while its HELD migration (20260702130000)
// is unapplied, so the hub shows no permanent degraded warning for a feature
// that simply is not live yet. `retention7d` is null until the HELD
// 20260702100000 migration (review_events) is applied; the UI hides the stat.
//
// Server-authoritative: reads via supabaseAdmin inside lib/review-hub, always
// scoped to auth.userId. The client never sends a user id.

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 30;

const SOURCES = ["weak_spot", "vocab", "class_flashcard", "study_set"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_SOURCE: HubSourceResult = { ok: true, items: [], dueCount: 0, nextDueInMs: null };

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT),
  );

  // Tolerated filters — invalid values fall back to the full merged queue.
  const sourceRaw = req.nextUrl.searchParams.get("source");
  const sourceFilter = (SOURCES as readonly string[]).includes(sourceRaw ?? "")
    ? (sourceRaw as (typeof SOURCES)[number])
    : null;
  const setRaw = req.nextUrl.searchParams.get("set");
  const setFilter =
    sourceFilter === "study_set" && setRaw && UUID_RE.test(setRaw) ? setRaw : null;

  const wants = (s: (typeof SOURCES)[number]) => !sourceFilter || sourceFilter === s;

  const emptyWeak = { ...EMPTY_SOURCE, items: [], totalWeakSpots: 0 };

  const [weak, vocab, cards, studySets, retention] = await Promise.all([
    wants("weak_spot") ? fetchWeakSpotQueue(userId, limit) : Promise.resolve(emptyWeak),
    wants("vocab") ? fetchVocabQueue(userId, limit) : Promise.resolve(EMPTY_SOURCE),
    wants("class_flashcard") ? fetchClassCardQueue(userId, limit) : Promise.resolve(EMPTY_SOURCE),
    wants("study_set")
      ? fetchStudySetQueue(userId, limit, setFilter)
      : Promise.resolve(EMPTY_SOURCE),
    fetchRetention7d(userId),
  ]);

  const items = interleaveQueues(
    [weak.items.map(weakSpotToHubItem), vocab.items, cards.items, studySets.items],
    limit,
  );

  const nextCandidates = [
    weak.nextDueInMs,
    vocab.nextDueInMs,
    cards.nextDueInMs,
    studySets.nextDueInMs,
  ].filter((v): v is number => v != null);

  return NextResponse.json({
    items,
    total: weak.dueCount + vocab.dueCount + cards.dueCount + studySets.dueCount,
    counts: {
      weak_spot: weak.dueCount,
      vocab: vocab.dueCount,
      class_flashcard: cards.dueCount,
      study_set: studySets.dueCount,
    },
    sources: {
      weak_spot: { ok: weak.ok },
      vocab: { ok: vocab.ok },
      class_flashcard: { ok: cards.ok },
      study_set: { ok: studySets.ok },
    },
    filtered: sourceFilter ? { source: sourceFilter, set: setFilter } : null,
    retention7d: retention,
    nextDueInMs: nextCandidates.length > 0 ? Math.min(...nextCandidates) : null,
  });
}
