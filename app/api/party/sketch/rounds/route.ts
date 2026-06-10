// POST /api/party/sketch/rounds — create a new sketch round in a room.
//
// Body: { code: string, subject?: string }
//
// Behavior:
//   - Verify caller is in the room and room.current_game === 'sketch'.
//   - Pick the next drawer in rotation (joined_at order, then round_num modulo
//     player count). The first round picks the host.
//   - Pick a subject from the room's enabled subjects (random if not given).
//   - Pick 3 candidate words; the drawer chooses one via /select-word.
//   - Returns the round id + the candidate words ONLY to the drawer (server
//     stashes candidates in-memory for the drawer's GET /words call).
//
// Word source: party_word_lists table when populated; otherwise the inline
// stub at lib/party/word-lists-stub.ts.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isRoomMember } from "@/lib/party/room-state";
import {
  WORD_LISTS_STUB,
  SUBJECTS as STUB_SUBJECTS,
  type Subject,
  type WordEntry,
} from "@/lib/party/word-lists-stub";
import { WORD_LISTS as CURATED_WORD_LISTS } from "@/lib/party/word-lists";
import { setCandidates } from "@/lib/party/sketch-candidates";

// ── Difficulty-tiered candidate picking ──────────────────────────────
// The drawer is always offered one EASY, one MEDIUM, and one HARD word, in
// that order. If a subject's pool is thin on a tier, we fall back to the
// NEAREST tier (never error): easy borrows from medium then hard; medium
// borrows from easy then hard; hard borrows from medium then easy. Words
// are never duplicated across the 3 slots, so a 2-word pool yields 2 cards
// and the round still plays.
const TIER_ORDER = ["easy", "medium", "hard"] as const;
type Tier = (typeof TIER_ORDER)[number];
const TIER_FALLBACKS: Record<Tier, Tier[]> = {
  easy: ["easy", "medium", "hard"],
  medium: ["medium", "easy", "hard"],
  hard: ["hard", "medium", "easy"],
};

function pickTieredCandidates(pool: WordEntry[]): WordEntry[] {
  if (pool.length === 0) return [];
  // Bucket by tier; anything with an unknown difficulty (pre-constraint DB
  // rows) is treated as medium so it stays pickable.
  const byTier: Record<Tier, WordEntry[]> = { easy: [], medium: [], hard: [] };
  for (const entry of pool) {
    const tier: Tier = (TIER_ORDER as readonly string[]).includes(entry.difficulty)
      ? (entry.difficulty as Tier)
      : "medium";
    byTier[tier].push(entry);
  }
  const used = new Set<string>();
  const picks: WordEntry[] = [];
  for (const tier of TIER_ORDER) {
    for (const fallback of TIER_FALLBACKS[tier]) {
      const available = byTier[fallback].filter((e) => !used.has(e.word));
      if (available.length > 0) {
        const pick = available[Math.floor(Math.random() * available.length)];
        used.add(pick.word);
        picks.push(pick);
        break;
      }
    }
  }
  return picks;
}

// Prefer the curator's curated pool (90+ words per subject) when available;
// fall back to the inline 10-word stub otherwise so things stay playable.
function pickCandidatesForSubject(subject: Subject): WordEntry[] {
  const curated = (CURATED_WORD_LISTS as Record<string, WordEntry[] | undefined>)[subject];
  const pool = curated && curated.length > 0 ? curated : WORD_LISTS_STUB[subject] ?? [];
  return pickTieredCandidates(pool);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const code = normalizeRoomCode(body?.code ?? "");
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, current_game, settings")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.current_game !== "sketch") {
    return NextResponse.json({ error: "Room is not playing sketch" }, { status: 400 });
  }

  // Perf pass 2026-06-10 — membership check, player roster, and prior-round
  // history only need room.id and are independent of each other. Running them
  // in parallel trims ~2 DB round-trips off EVERY round creation (this route
  // sits on the Start → pick-a-word critical path and fires between rounds).
  const [isMember, { data: players }, { data: priorRounds }] = await Promise.all([
    isRoomMember(supabaseAdmin, room.id, userId),
    // Drawer rotation + per-player topic picks. Sorted by joined_at so the
    // rotation is deterministic.
    supabaseAdmin
      .from("party_room_players")
      .select("user_id, joined_at, selected_subjects")
      .eq("room_id", room.id)
      .is("left_at", null)
      .order("joined_at", { ascending: true }),
    // All prior rounds: highest round_num for numbering + per-player draw
    // counts for a fair-but-random drawer pick.
    supabaseAdmin
      .from("sketch_rounds")
      .select("round_num, drawer_user_id")
      .eq("room_id", room.id),
  ]);
  if (!isMember) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }
  if (!players || players.length < 2) {
    return NextResponse.json({ error: "Not enough players" }, { status: 400 });
  }
  const nextRoundNum =
    (priorRounds && priorRounds.length > 0
      ? Math.max(...priorRounds.map((r) => r.round_num ?? 0))
      : 0) + 1;

  // Fair-but-random drawer: count how many times each active player has drawn,
  // then pick randomly among those who've drawn the FEWEST. Round 1 = everyone
  // at 0 draws = fully random, so the room creator isn't forced to draw first.
  // Each rotation everyone draws once before anyone draws twice (fairness),
  // with the order shuffled within each tier (variety).
  const drawCounts = new Map<string, number>();
  for (const p of players) drawCounts.set(p.user_id, 0);
  for (const r of priorRounds ?? []) {
    if (r.drawer_user_id && drawCounts.has(r.drawer_user_id)) {
      drawCounts.set(r.drawer_user_id, (drawCounts.get(r.drawer_user_id) ?? 0) + 1);
    }
  }
  const minDraws = Math.min(...players.map((p) => drawCounts.get(p.user_id) ?? 0));
  const leastDrawn = players.filter((p) => (drawCounts.get(p.user_id) ?? 0) === minDraws);
  const drawerUserId = leastDrawn[Math.floor(Math.random() * leastDrawn.length)].user_id;

  // Subject pool resolution — per-player picks (weighted multiset) take
  // priority. Each player picks up to 2 topics; a subject picked by N
  // players appears N times in the weighted pool, so it's N times as
  // likely to be drawn. Players with no picks don't contribute.
  // Fallbacks: room.settings.subjects (legacy host-picked list), then all.
  const weightedPool: string[] = [];
  for (const p of players) {
    if (Array.isArray(p.selected_subjects)) {
      for (const s of p.selected_subjects) {
        if (typeof s === "string" && s.length > 0) weightedPool.push(s);
      }
    }
  }
  const fallbackSubjects: string[] = Array.isArray(room.settings?.subjects) && room.settings.subjects.length > 0
    ? room.settings.subjects
    : Array.from(STUB_SUBJECTS);

  // Caller can override subject if it appears in the active pool.
  const requestedSubject: string | undefined = body?.subject;
  let subject: Subject;
  if (requestedSubject && (weightedPool.includes(requestedSubject) || fallbackSubjects.includes(requestedSubject))) {
    subject = requestedSubject as Subject;
  } else if (weightedPool.length > 0) {
    // Weighted random — multiset already encodes the per-subject weight.
    subject = weightedPool[Math.floor(Math.random() * weightedPool.length)] as Subject;
  } else {
    // No one picked anything — uniform across the fallback set.
    subject = fallbackSubjects[Math.floor(Math.random() * fallbackSubjects.length)] as Subject;
  }

  // Try DB word list first; fall back to the curated/stub pools. Either way
  // the drawer gets one easy + one medium + one hard card (in that order),
  // with nearest-tier fallback when a subject runs thin on a tier.
  let candidates: WordEntry[] = [];
  const { data: dbWords } = await supabaseAdmin
    .from("party_word_lists")
    .select("word, difficulty, factoid")
    .eq("subject", subject)
    .limit(500);
  if (dbWords && dbWords.length >= 3) {
    candidates = pickTieredCandidates(
      dbWords.map((r) => ({
        word: r.word as string,
        difficulty: (r.difficulty ?? "medium") as WordEntry["difficulty"],
        factoid: r.factoid as string,
      })),
    );
  } else {
    candidates = pickCandidatesForSubject(subject);
  }
  if (candidates.length === 0) {
    // Hard fallback so we never block the round.
    candidates = pickTieredCandidates(WORD_LISTS_STUB.biology);
  }

  // Create the round with a placeholder word; updated in /select-word. Persist
  // the candidate set on the row (JSONB, migration 058) so the drawer's /words
  // fetch is reliable on Vercel serverless — the in-memory cache below is kept
  // as a warm-path optimization but is no longer the source of truth.
  const { data: round, error } = await supabaseAdmin
    .from("sketch_rounds")
    .insert({
      room_id: room.id,
      round_num: nextRoundNum,
      drawer_user_id: drawerUserId,
      word: "__pending__",
      subject,
      duration_sec: 90,
      candidate_words: candidates,
    })
    .select()
    .single();
  if (error || !round) {
    console.error("[party/sketch/rounds] insert", error?.message);
    return NextResponse.json({ error: "Couldn't create round" }, { status: 500 });
  }

  setCandidates(round.id, candidates);

  // V2 — promote any queued mid-game joiners into the live roster.
  // is_pending_round was set when they came in during a previous round;
  // clearing it here means SketchView (and equivalents) immediately drop
  // the spectator banner on their next ROUND_STARTED broadcast.
  await supabaseAdmin
    .from("party_room_players")
    .update({ is_pending_round: false })
    .eq("room_id", room.id)
    .is("left_at", null)
    .eq("is_pending_round", true);

  // Public payload: drawer + round id + subject. No words leaked to guessers.
  //
  // Perf pass 2026-06-10 — if the CALLER is the drawer (host got picked),
  // include the candidates inline so the client skips the follow-up
  // GET /rounds/[id]/words round-trip entirely. This response goes only to
  // the round creator, so nothing leaks: non-drawer callers get no words
  // (their drawer still fetches /words after the ROUND_STARTED broadcast),
  // and guessers never see candidates either way.
  const callerIsDrawer = drawerUserId === userId;
  return NextResponse.json({
    round: {
      id: round.id,
      room_id: round.room_id,
      round_num: round.round_num,
      drawer_user_id: drawerUserId,
      subject,
      duration_sec: round.duration_sec,
      started_at: round.started_at,
    },
    // Indicate the drawer should GET /words next (skipped when candidate_words
    // is present — same drawer-only payload shape as the /words route).
    drawer_should_pick: true,
    ...(callerIsDrawer
      ? {
          candidate_words: candidates.map((c) => ({
            word: c.word,
            difficulty: c.difficulty,
            factoid: c.factoid,
          })),
        }
      : {}),
  });
}

// GET /api/party/sketch/rounds — no-op warmer. The lobby pings this when the
// host selects the Sketchy tile so the serverless function (and its
// statically-imported curated word lists — the heavy part of this module's
// cold start) is hot before the host hits Start. Returns no data and reads
// nothing, so it's safe unauthenticated.
export async function GET() {
  return NextResponse.json({ ok: true });
}
