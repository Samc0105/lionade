// POST /api/party/sketch/rounds/[id]/reroll — the drawer re-rolls their 3
// candidate words ONCE per round, from the SAME source the round was created
// with (curated subject or Word Bank).
//
// Drawer-only. 403 for anyone else, 409 if the round was already rerolled or
// the word is already locked. Re-picks candidate_words on the round row +
// updates the in-memory cache, and flips sketch_rounds.rerolled = true so a
// second call is rejected.
//
// Response: { candidate_words: [...] } — the SAME drawer-only payload shape as
// GET /rounds/[id]/words, including the `source` field on bank candidates.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { setCandidates } from "@/lib/party/sketch-candidates";
import {
  pickCuratedCandidates,
  pickBankCandidates,
} from "@/lib/party/sketch-pick";
import type { WordEntry } from "@/lib/party/word-lists-stub";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("id, drawer_user_id, word, subject, source_kind, source_bank_id, rerolled")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.drawer_user_id !== userId) {
    return NextResponse.json({ error: "Only the drawer can reroll" }, { status: 403 });
  }
  if (round.word && round.word !== "__pending__") {
    return NextResponse.json({ error: "Word already locked" }, { status: 409 });
  }
  if (round.rerolled) {
    return NextResponse.json({ error: "You already rerolled this round" }, { status: 409 });
  }

  // Re-pick from the SAME source. Bank rounds re-draw from the bank (owner =
  // the drawer, who must own the bank to have a bank round); if the bank can no
  // longer produce words (deleted / too few) we fall back to the round's
  // subject as a curated source so the reroll never fails.
  let candidates: WordEntry[] = [];
  if (round.source_kind === "bank" && round.source_bank_id) {
    const bankCandidates = await pickBankCandidates(
      supabaseAdmin,
      round.source_bank_id as string,
      userId,
    );
    if (bankCandidates && bankCandidates.length > 0) {
      candidates = bankCandidates;
    }
  }
  if (candidates.length === 0) {
    // Curated round, or bank fallback. round.subject holds either the curated
    // id or the bank display name; for a fallen-back bank round we just use a
    // curated pick keyed on the subject string (pickCuratedCandidates is
    // tolerant and ends on a biology hard fallback so it never empties).
    const subjectForCurated =
      round.source_kind === "bank" ? "biology" : (round.subject as string);
    candidates = await pickCuratedCandidates(supabaseAdmin, subjectForCurated);
  }

  // Atomic one-shot guard: only flip rerolled if it's still false. If a
  // concurrent reroll already set it, this update matches zero rows and we
  // bail with 409 rather than handing out a second set of candidates.
  const { data: updated, error } = await supabaseAdmin
    .from("sketch_rounds")
    .update({ candidate_words: candidates, rerolled: true })
    .eq("id", params.id)
    .eq("rerolled", false)
    .eq("word", "__pending__")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[party/sketch/reroll]", error.message);
    return NextResponse.json({ error: "Couldn't reroll" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "You already rerolled this round" }, { status: 409 });
  }

  setCandidates(params.id, candidates);

  return NextResponse.json({
    candidate_words: candidates.map((c) => ({
      word: c.word,
      difficulty: c.difficulty,
      factoid: c.factoid,
      ...(c.source ? { source: c.source } : {}),
    })),
  });
}
