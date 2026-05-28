// POST /api/party/sketch/rounds/[id]/guess — submit a guess.
//
// Body: { guess: string }
//
// Server validates the guess against the locked word using fuzzy matching:
//   - exact (normalized) match: correct, award rank-based points
//   - Levenshtein distance 1 or 2: "close" but does not earn points
//   - else: wrong, recorded as wrong, no broadcast leak of the target
//
// Anti-cheat: drawer cannot submit guesses. We never echo the target word.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { compareGuess } from "@/lib/party/levenshtein";
import { sketchGuessPoints } from "@/lib/party/scoring";

const MAX_GUESS_LEN = 64;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("id, room_id, word, drawer_user_id, ended_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.ended_at) return NextResponse.json({ error: "Round ended" }, { status: 410 });
  if (!round.word || round.word === "__pending__") {
    return NextResponse.json({ error: "Drawer hasn't picked a word yet" }, { status: 409 });
  }
  if (round.drawer_user_id === userId) {
    return NextResponse.json({ error: "Drawer can't guess" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const guessRaw: string | undefined = body?.guess;
  if (typeof guessRaw !== "string" || guessRaw.length === 0) {
    return NextResponse.json({ error: "Empty guess" }, { status: 400 });
  }
  const guess = guessRaw.slice(0, MAX_GUESS_LEN);

  // Block re-guessing after a correct answer (one correct per player per round).
  const { data: priorCorrect } = await supabaseAdmin
    .from("sketch_guesses")
    .select("id")
    .eq("round_id", round.id)
    .eq("user_id", userId)
    .eq("was_correct", true)
    .maybeSingle();
  if (priorCorrect) {
    return NextResponse.json({ ok: true, was_correct: true, already_correct: true });
  }

  const verdict = compareGuess(guess, round.word);
  let pointsEarned = 0;
  if (verdict === "correct") {
    const { count: priorCorrectCount } = await supabaseAdmin
      .from("sketch_guesses")
      .select("id", { count: "exact", head: true })
      .eq("round_id", round.id)
      .eq("was_correct", true);
    const rank = (priorCorrectCount ?? 0) + 1;
    pointsEarned = sketchGuessPoints(rank);

    // Bump scoreboard.
    const { data: rowToBump } = await supabaseAdmin
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (rowToBump) {
      await supabaseAdmin
        .from("party_room_players")
        .update({ score: (rowToBump.score ?? 0) + pointsEarned })
        .eq("room_id", round.room_id)
        .eq("user_id", userId);
    }
  }

  const isCorrect = verdict === "correct";
  const isClose = verdict === "close";

  await supabaseAdmin.from("sketch_guesses").insert({
    round_id: round.id,
    user_id: userId,
    // Never persist the verbatim guess if it was correct — we'd leak the word
    // through a future GET. Store a redacted marker; broadcasts already filter.
    guess: isCorrect ? "[correct]" : guess,
    was_correct: isCorrect,
    was_close: isClose,
    points_earned: pointsEarned,
  });

  return NextResponse.json({
    ok: true,
    verdict,
    was_correct: isCorrect,
    was_close: isClose,
    points_earned: pointsEarned,
  });
}
