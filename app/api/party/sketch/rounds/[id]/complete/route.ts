// /api/party/sketch/rounds/[id]/complete — close out a sketch round.
//
// POST: called by the drawer (or auto-fired by the round timer client-side when
//   the 90-second window ends, also allowed for the host on timeout). Computes
//   the drawer's reward, marks ended_at, returns the reveal payload (word +
//   factoid + per-player scores). Authorized to the drawer OR host.
//
// GET: server-side LAZY completion (resilience backstop). If the drawing
//   deadline (started_at + duration_sec) has passed, ANY active room member who
//   GETs this route completes the round inline — CAS-guarded so the drawer
//   reward is applied exactly once. This self-heals a round whose drawer AND
//   host both have backgrounded (timer-throttled) tabs, which the POST path
//   alone can't recover (only the drawer/host fire it). Mirrors the bluff/
//   trivia GET lazy-advance. A non-member, or a not-yet-expired round, gets the
//   current state with no mutation.
//
// Drawer reward (in completeSketchRound):
//   +100 per correct guesser, +200 bonus if 80%+ guessed within first 30s.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";
import { completeSketchRound, isSketchDrawingExpired } from "@/lib/party/sketch-advance";

const ROUND_SELECT =
  "id, room_id, word, factoid, drawer_user_id, started_at, ended_at, duration_sec, phase, winner_user_id, celebrating_started_at, source_kind";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select(ROUND_SELECT)
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.ended_at) {
    // Already completed; return idempotent reveal. (Phase + winner already on the row.)
    return buildReveal(round.id, round.word, round.factoid, round.drawer_user_id, round.room_id, round.source_kind);
  }

  // Allow drawer OR host to complete the round (timeout case).
  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("host_user_id")
    .eq("id", round.room_id)
    .maybeSingle();
  const isAuthorized =
    round.drawer_user_id === auth.userId || room?.host_user_id === auth.userId;
  if (!isAuthorized) {
    return NextResponse.json({ error: "Not authorized to complete round" }, { status: 403 });
  }

  // Single source of truth for the scoring + CAS completion. Safe to race with a
  // GET lazy-completion: only the CAS winner applies the drawer reward.
  await completeSketchRound(supabaseAdmin, round);

  return buildReveal(round.id, round.word, round.factoid, round.drawer_user_id, round.room_id, round.source_kind);
}

// GET — lazy completion backstop. Self-heals a stuck drawing round when its
// server deadline has passed, for ANY active room member (not just drawer/host).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select(ROUND_SELECT)
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Membership check prevents a cross-room round id from poking another game.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, auth.userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Only complete once the drawing deadline has genuinely passed; otherwise
  // leave the live round untouched (the drawer's timer is still the fast path).
  if (isSketchDrawingExpired(round)) {
    await completeSketchRound(supabaseAdmin, round);
    // Re-read so the reveal reflects the freshly-stamped word/winner.
    const { data: fresh } = await supabaseAdmin
      .from("sketch_rounds")
      .select(ROUND_SELECT)
      .eq("id", params.id)
      .maybeSingle();
    const r = fresh ?? round;
    return buildReveal(r.id, r.word, r.factoid, r.drawer_user_id, r.room_id, r.source_kind);
  }

  // Not expired (or already ended): return the current reveal/state snapshot.
  return buildReveal(round.id, round.word, round.factoid, round.drawer_user_id, round.room_id, round.source_kind);
}

async function buildReveal(
  roundId: string,
  word: string,
  factoid: string | null,
  drawerUserId: string,
  roomId: string,
  sourceKind: string | null,
) {
  const { data: players } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, score, profiles!inner(username)")
    .eq("room_id", roomId);
  const scoreboard = (players ?? []).map((p) => ({
    user_id: p.user_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    username: Array.isArray((p as any).profiles)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p as any).profiles[0]?.username
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p as any).profiles?.username,
    score: p.score ?? 0,
  }));

  return NextResponse.json({
    ok: true,
    round_id: roundId,
    word,
    factoid,
    // Drives the reveal's DEFINITION eyebrow for bank rounds on EVERY client
    // (not just the drawer who tapped the card). 'curated' for normal rounds.
    source_kind: sourceKind ?? "curated",
    drawer_user_id: drawerUserId,
    scoreboard: scoreboard.sort((a, b) => b.score - a.score),
  });
}
