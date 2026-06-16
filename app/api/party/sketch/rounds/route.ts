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
import { assertFeatureLive } from "@/lib/feature-flags";
import { recordFeatureError } from "@/lib/feature-health";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isRoomMember } from "@/lib/party/room-state";
import {
  WORD_LISTS_STUB,
  SUBJECTS as STUB_SUBJECTS,
  type WordEntry,
} from "@/lib/party/word-lists-stub";
import { setCandidates } from "@/lib/party/sketch-candidates";
import { isBankToken, parseBankToken } from "@/lib/party/sketch-bank-source";
import {
  pickTieredCandidates,
  pickCuratedCandidates,
  pickBankCandidates,
} from "@/lib/party/sketch-pick";

// When a chosen bank can't produce a round (deleted / too few words / not
// owned), fall back to a curated subject. Prefer a curated subject already in
// the weighted pool (someone wanted it); otherwise pick from the fallback set.
function pickCuratedFallback(weightedPool: string[], fallbackSubjects: string[]): string {
  const curatedInPool = weightedPool.filter((s) => !isBankToken(s));
  if (curatedInPool.length > 0) {
    return curatedInPool[Math.floor(Math.random() * curatedInPool.length)];
  }
  if (fallbackSubjects.length > 0) {
    return fallbackSubjects[Math.floor(Math.random() * fallbackSubjects.length)];
  }
  return "biology";
}

// Bank source: resolve "bank:<uuid>" into a round. Verifies the bank still
// exists, is OWNED by ownerId, and still has enough words; returns the bank
// NAME (display label) + 3 random bank candidates, or null if it can't produce
// a round (caller then falls back to a curated subject so it never blocks).
async function resolveBankRound(
  bankId: string,
  ownerId: string,
): Promise<{ name: string; candidates: (WordEntry & { source: "bank" })[] } | null> {
  const candidates = await pickBankCandidates(supabaseAdmin, bankId, ownerId);
  if (!candidates) return null;
  const { data: bank } = await supabaseAdmin
    .from("vocab_banks")
    .select("name")
    .eq("id", bankId)
    .maybeSingle();
  if (!bank) return null;
  return { name: bank.name as string, candidates };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const m = await assertFeatureLive("games.party.sketch");
  if (m) return m;

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
  // priority. Each player picks up to 2 sources; a source picked by N
  // players appears N times in the weighted pool, so it's N times as
  // likely to be drawn. Players with no picks don't contribute. Tokens may
  // be bare curated subjects ("biology") OR Word-Bank tokens ("bank:<uuid>").
  // Fallbacks: room.settings.subjects (legacy host-picked list), then all.
  const weightedPool: string[] = [];
  // Map a bank token -> the userIds who picked it. A bank round is owned by
  // the player who selected it (verified at draw time), NOT the drawer.
  const bankTokenOwners = new Map<string, string[]>();
  for (const p of players) {
    if (Array.isArray(p.selected_subjects)) {
      for (const s of p.selected_subjects) {
        if (typeof s !== "string" || s.length === 0) continue;
        weightedPool.push(s);
        if (isBankToken(s)) {
          const owners = bankTokenOwners.get(s) ?? [];
          if (!owners.includes(p.user_id)) owners.push(p.user_id);
          bankTokenOwners.set(s, owners);
        }
      }
    }
  }
  const fallbackSubjects: string[] = Array.isArray(room.settings?.subjects) && room.settings.subjects.length > 0
    ? room.settings.subjects
    : Array.from(STUB_SUBJECTS);

  // Caller can override the source if it appears in the active pool.
  const requestedSubject: string | undefined = body?.subject;
  let sourceToken: string;
  if (requestedSubject && (weightedPool.includes(requestedSubject) || fallbackSubjects.includes(requestedSubject))) {
    sourceToken = requestedSubject;
  } else if (weightedPool.length > 0) {
    // Weighted random — multiset already encodes the per-source weight.
    sourceToken = weightedPool[Math.floor(Math.random() * weightedPool.length)];
  } else {
    // No one picked anything — uniform across the fallback set.
    sourceToken = fallbackSubjects[Math.floor(Math.random() * fallbackSubjects.length)];
  }

  // Resolve the chosen source into candidate words + the round's source fields.
  let candidates: WordEntry[] = [];
  let subject: string; // sketch_rounds.subject — curated id OR bank display name
  let sourceKind: "curated" | "bank" = "curated";
  let sourceBankId: string | null = null;

  const bankId = isBankToken(sourceToken) ? parseBankToken(sourceToken) : null;
  if (bankId) {
    // Bank round. Verify against ANY player who picked this token (the owner).
    const owners = bankTokenOwners.get(sourceToken);
    let resolved: Awaited<ReturnType<typeof resolveBankRound>> = null;
    for (const ownerId of owners ?? []) {
      resolved = await resolveBankRound(bankId, ownerId);
      if (resolved) break;
    }
    if (resolved) {
      candidates = resolved.candidates;
      subject = resolved.name;
      sourceKind = "bank";
      sourceBankId = bankId;
    } else {
      // Bank was deleted / dropped below the play floor / no longer owned.
      // Fall back to a curated subject from the pool (or the stub) so the
      // round never blocks.
      subject = pickCuratedFallback(weightedPool, fallbackSubjects);
    }
  } else {
    subject = sourceToken;
  }

  // Curated path (initial pick OR bank fallback): DB word list first, then the
  // curated/stub pools. The drawer gets one easy + one medium + one hard card.
  if (sourceKind === "curated") {
    candidates = await pickCuratedCandidates(supabaseAdmin, subject);
  }
  if (candidates.length === 0) {
    // Hard fallback so we never block the round.
    candidates = pickTieredCandidates(WORD_LISTS_STUB.biology);
    if (sourceKind === "bank") {
      sourceKind = "curated";
      sourceBankId = null;
      subject = "biology";
    }
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
      source_kind: sourceKind,
      source_bank_id: sourceBankId,
    })
    .select()
    .single();
  if (error || !round) {
    recordFeatureError("games.party.sketch");
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
            ...(c.source ? { source: c.source } : {}),
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
