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

// Prefer the curator's curated pool (50+ words per subject) when available;
// fall back to the inline 10-word stub otherwise so things stay playable.
function pickCandidatesForSubject(subject: Subject, count = 3): WordEntry[] {
  const curated = (CURATED_WORD_LISTS as Record<string, WordEntry[] | undefined>)[subject];
  const pool = curated && curated.length > 0 ? curated : WORD_LISTS_STUB[subject] ?? [];
  if (pool.length === 0) return [];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
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

  const isMember = await isRoomMember(supabaseAdmin, room.id, userId);
  if (!isMember) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Determine drawer rotation + collect per-player topic picks.
  // Players sorted by joined_at so rotation is deterministic.
  const { data: players } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, joined_at, selected_subjects")
    .eq("room_id", room.id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (!players || players.length < 2) {
    return NextResponse.json({ error: "Not enough players" }, { status: 400 });
  }

  const { data: previousRounds } = await supabaseAdmin
    .from("sketch_rounds")
    .select("round_num")
    .eq("room_id", room.id)
    .order("round_num", { ascending: false })
    .limit(1);
  const nextRoundNum = (previousRounds?.[0]?.round_num ?? 0) + 1;
  const drawerIdx = (nextRoundNum - 1) % players.length;
  const drawerUserId = players[drawerIdx].user_id;

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

  // Try DB word list first; fall back to stub.
  let candidates: WordEntry[] = [];
  const { data: dbWords } = await supabaseAdmin
    .from("party_word_lists")
    .select("word, difficulty, factoid")
    .eq("subject", subject)
    .limit(50);
  if (dbWords && dbWords.length >= 3) {
    const shuffled = [...dbWords].sort(() => Math.random() - 0.5).slice(0, 3);
    candidates = shuffled.map((r) => ({
      word: r.word as string,
      difficulty: (r.difficulty ?? "medium") as WordEntry["difficulty"],
      factoid: r.factoid as string,
    }));
  } else {
    candidates = pickCandidatesForSubject(subject, 3);
  }
  if (candidates.length === 0) {
    // Hard fallback so we never block the round.
    candidates = WORD_LISTS_STUB.biology.slice(0, 3);
  }

  // Create the round with a placeholder word; updated in /select-word.
  const { data: round, error } = await supabaseAdmin
    .from("sketch_rounds")
    .insert({
      room_id: room.id,
      round_num: nextRoundNum,
      drawer_user_id: drawerUserId,
      word: "__pending__",
      subject,
      duration_sec: 90,
    })
    .select()
    .single();
  if (error || !round) {
    console.error("[party/sketch/rounds] insert", error?.message);
    return NextResponse.json({ error: "Couldn't create round" }, { status: 500 });
  }

  setCandidates(round.id, candidates);

  // Public payload: drawer + round id + subject. No words leaked to guessers.
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
    // Indicate the drawer should GET /words next.
    drawer_should_pick: true,
  });
}
