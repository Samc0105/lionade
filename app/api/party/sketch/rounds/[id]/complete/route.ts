// POST /api/party/sketch/rounds/[id]/complete — close out a sketch round.
//
// Called by the host (or auto-fired by the round timer client-side when the
// 90-second window ends). Computes the drawer's reward, marks ended_at,
// returns the reveal payload (word + factoid + per-player scores).
//
// Drawer reward:
//   +100 per correct guesser, +200 bonus if 80%+ guessed within first 30s.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { sketchDrawerPoints } from "@/lib/party/scoring";
import { awardSketchFangs } from "@/lib/party/sketch-fangs";
import { sketchDrawerFangs } from "@/lib/party/sketch-economy";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("id, room_id, word, factoid, drawer_user_id, started_at, ended_at, duration_sec, phase, winner_user_id, celebrating_started_at, source_kind")
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

  // Count correct guessers + fast guessers (within first 30s). Order by
  // guessed_at so the FIRST correct guess identifies the round's winner.
  const { data: correctGuesses } = await supabaseAdmin
    .from("sketch_guesses")
    .select("user_id, guessed_at")
    .eq("round_id", round.id)
    .eq("was_correct", true)
    .order("guessed_at", { ascending: true });
  const correctCount = correctGuesses?.length ?? 0;
  const winnerUserId = correctGuesses && correctGuesses.length > 0
    ? correctGuesses[0].user_id
    : null;

  const startMs = new Date(round.started_at).getTime();
  const fastCount = (correctGuesses ?? []).filter(
    (g) => new Date(g.guessed_at).getTime() - startMs <= 30_000,
  ).length;
  // Active guesser denominator = active players minus the drawer.
  const { count: activePlayers } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", round.room_id)
    .is("left_at", null);
  const guesserDenom = Math.max(1, (activePlayers ?? 1) - 1);
  const fastRatio = fastCount / guesserDenom;

  const drawerReward = sketchDrawerPoints(correctCount, fastRatio);
  if (drawerReward > 0) {
    const { data: drawerRow } = await supabaseAdmin
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", round.drawer_user_id)
      .maybeSingle();
    if (drawerRow) {
      await supabaseAdmin
        .from("party_room_players")
        .update({ score: (drawerRow.score ?? 0) + drawerReward })
        .eq("room_id", round.room_id)
        .eq("user_id", round.drawer_user_id);
    }
  }

  // Fang faucet: the drawer earns minted Fangs when their word gets guessed
  // (per correct guesser, capped). Idempotent per (round, drawer) — a re-fired
  // /complete never double-mints. Server-authoritative.
  await awardSketchFangs(supabaseAdmin, {
    roundId: round.id,
    userId: round.drawer_user_id,
    reason: "drawing",
    fangs: sketchDrawerFangs(correctCount),
  });

  // Persist the round-end state in ONE update:
  //   - ended_at           (legacy timestamp consumers still read)
  //   - phase              ("celebrating" — UI shows the win/timeout overlay)
  //   - winner_user_id     (first correct guesser, or NULL on timeout)
  //   - celebrating_started_at (anchor for the 2.5s overlay window)
  //
  // The frontend still reads the live broadcast for the instant render, but
  // persisting the phase means a player who refreshes during the overlay
  // lands BACK on the celebration (sees the rest of it) rather than skipping
  // to the reveal.
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("sketch_rounds")
    .update({
      ended_at: nowIso,
      phase: "celebrating",
      winner_user_id: winnerUserId,
      celebrating_started_at: nowIso,
    })
    .eq("id", round.id);

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
