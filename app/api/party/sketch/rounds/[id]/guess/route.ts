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
import { isRoomMember } from "@/lib/party/room-state";
import { sketchGuessPoints } from "@/lib/party/scoring";
import { buildWordMask, matchLetterPositions } from "@/lib/party/letter-reveal";
import { awardSketchFangs } from "@/lib/party/sketch-fangs";
import { completeSketchRound, isSketchDrawingExpired } from "@/lib/party/sketch-advance";
import {
  sketchGuessFangs,
  SKETCH_LETTER_FANGS,
  SKETCH_LETTER_FANGS_CAP_PER_PLAYER,
} from "@/lib/party/sketch-economy";

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
    .select("id, room_id, word, drawer_user_id, ended_at, started_at, duration_sec, phase")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Resilience backstop: if the drawing deadline (started_at + duration_sec) has
  // already passed but the drawer AND host both backgrounded their tabs (so
  // neither timer fired /complete), the round is stuck. A guesser is exactly the
  // still-active player who would keep poking this route — complete it inline
  // here (CAS-guarded, scores once) so any guess after the window self-heals the
  // room, then reject this guess as past the deadline. Mirrors the bluff/trivia
  // GET lazy-advance, adapted to Sketchy's broadcast-driven (no round-poll) model.
  if (!round.ended_at && isSketchDrawingExpired(round)) {
    await completeSketchRound(supabaseAdmin, round);
    return NextResponse.json({ error: "Round ended" }, { status: 410 });
  }
  if (round.ended_at) return NextResponse.json({ error: "Round ended" }, { status: 410 });
  if (!round.word || round.word === "__pending__") {
    return NextResponse.json({ error: "Drawer hasn't picked a word yet" }, { status: 409 });
  }
  if (round.drawer_user_id === userId) {
    return NextResponse.json({ error: "Drawer can't guess" }, { status: 403 });
  }

  // Membership check prevents cross-room round-id leaks polluting another game.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
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
  let fangsEarned = 0;
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

    // Fang faucet: mint the per-correct-guess reward (base + order bonus),
    // idempotent per (round, user). Server-authoritative — never client-trusted.
    fangsEarned += await awardSketchFangs(supabaseAdmin, {
      roundId: round.id,
      userId,
      reason: "guess",
      fangs: sketchGuessFangs(rank),
    });
  }

  const isCorrect = verdict === "correct";
  const isClose = verdict === "close";

  // ── Wordle reveal (server-computed) ──
  // Compute which letter POSITIONS this guess matched against the SECRET word.
  // We never ship the secret to the client — only the matched positions + the
  // letters the guesser already typed there. The structural mask reveals length
  // and punctuation (intended), nothing more.
  const matchedAll = matchLetterPositions(guess, round.word);
  const mask = buildWordMask(round.word);

  // ── Reveal cap (word-leak fix 2026-06-11) ──
  // matchLetterPositions returns EVERY positionally-matching letter, so a
  // near-miss superstring/typo guess ("tigers" vs "tiger", graded merely
  // "close") used to match ALL positions of the secret — we inserted +
  // returned them all, the submitter broadcast LETTER_REVEAL, and the entire
  // word lit up green on every screen MID-ROUND. The progressive reveal is a
  // hint faucet, not a disclosure channel: a hidden floor of letters (1/3 of
  // the word's letter cells, minimum 1) can never be revealed by guesses, so
  // the round-end reveal stays the first time non-drawers see the full word.
  // The clamp is server-authoritative — positions beyond the cap are never
  // inserted, never returned, and therefore never broadcast.
  const letterCellCount = mask.filter((c) => c.kind === "letter").length;
  const hiddenFloor = Math.max(1, Math.ceil(letterCellCount / 3));
  const maxRevealable = Math.max(0, letterCellCount - hiddenFloor);

  // `matched` = the positions this guess is ALLOWED to surface client-side:
  // positions already public (revealed by any prior guess) plus new ones up
  // to the cap, left-to-right deterministic. Drives matched_positions in the
  // response (own-text highlight + the GUESS broadcast's highlight indices).
  const matched: typeof matchedAll = [];
  let newlyRevealed: { position: number; letter: string }[] = [];
  if (matchedAll.length > 0 && maxRevealable > 0) {
    const { data: existingRows } = await supabaseAdmin
      .from("sketch_revealed_positions")
      .select("position")
      .eq("round_id", round.id);
    const existing = new Set((existingRows ?? []).map((r) => r.position as number));
    let budget = Math.max(0, maxRevealable - existing.size);
    const toInsert: typeof matchedAll = [];
    for (const m of [...matchedAll].sort((a, b) => a.position - b.position)) {
      if (existing.has(m.position)) {
        // Already public knowledge — fine to echo back for highlighting.
        matched.push(m);
      } else if (budget > 0) {
        matched.push(m);
        toInsert.push(m);
        budget -= 1;
      }
      // Beyond the cap: dropped entirely. Not inserted, not returned.
    }

    // First guesser to land a NEW correct-position letter claims its per-letter
    // Fang. We INSERT each allowed position with ON CONFLICT DO NOTHING so only
    // the first revealer's row sticks; the inserted rows tell us what was new.
    if (toInsert.length > 0) {
      const rows = toInsert.map((m) => ({
        round_id: round.id,
        position: m.position,
        letter: m.letter,
        revealed_by: userId,
      }));
      const { data: insertedPositions } = await supabaseAdmin
        .from("sketch_revealed_positions")
        .upsert(rows, { onConflict: "round_id,position", ignoreDuplicates: true })
        .select("position, letter");
      newlyRevealed = insertedPositions ?? [];
    }

    // Per-letter Fang trickle to THIS guesser for positions they revealed first,
    // capped per player per round. One ledger row per (round, user) reason so the
    // cap is enforced by the running total, not per-position double-mints.
    if (newlyRevealed.length > 0) {
      const { data: priorLetters } = await supabaseAdmin
        .from("sketch_fang_awards")
        .select("fangs")
        .eq("round_id", round.id)
        .eq("user_id", userId)
        .eq("reason", "letters");
      const priorLetterFangs = priorLetters?.[0]?.fangs ?? 0;
      const roomFor = Math.max(0, SKETCH_LETTER_FANGS_CAP_PER_PLAYER - priorLetterFangs);
      const grant = Math.min(roomFor, newlyRevealed.length * SKETCH_LETTER_FANGS);
      if (grant > 0) {
        // Upsert the running letter total for this player this round, then mint
        // only the delta to coins (the unique reason row holds the cumulative).
        await supabaseAdmin
          .from("sketch_fang_awards")
          .upsert(
            { round_id: round.id, user_id: userId, reason: "letters", fangs: priorLetterFangs + grant },
            { onConflict: "round_id,user_id,reason" },
          );
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("coins")
          .eq("id", userId)
          .maybeSingle();
        if (prof) {
          await supabaseAdmin
            .from("profiles")
            .update({ coins: (prof.coins ?? 0) + grant })
            .eq("id", userId);
        }
        fangsEarned += grant;
      }
    }
  }

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
    fangs_earned: fangsEarned,
    // Wordle reveal payload — matched positions only, NEVER the secret word,
    // and clamped to the hidden-floor cap (a guess can never uncover the
    // whole word; the floor letters stay blank until the round-end reveal).
    mask,
    matched_positions: matched, // this guess's allowed green squares
    newly_revealed: newlyRevealed, // positions this guess revealed for the room
  });
}
