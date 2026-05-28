// POST /api/party/bluff/rounds/[id]/answer — submit a fake answer.
//
// Body: { text: string }
//
// Server validates the fake is NOT identical (case + whitespace-insensitive)
// to the truth answer; rejects if so to stop "type the real answer as my
// fake" gaming. Also rejects if phase !== 'write'.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { normalize } from "@/lib/party/levenshtein";

const MAX_LEN = 80;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const rawText: string | undefined = body?.text;
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return NextResponse.json({ error: "Empty answer" }, { status: 400 });
  }
  const text = rawText.trim().slice(0, MAX_LEN);

  const { data: round } = await supabaseAdmin
    .from("bluff_rounds")
    .select("id, phase, correct_answer, room_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.phase !== "write") {
    return NextResponse.json({ error: "Write phase has ended" }, { status: 409 });
  }

  // Reject if the fake is the truth.
  if (normalize(text) === normalize(round.correct_answer)) {
    return NextResponse.json(
      { error: "That's the real answer. Try a different fake." },
      { status: 400 },
    );
  }

  // Reject duplicates of an existing answer in this round (case-insensitive).
  const { data: existingAnswers } = await supabaseAdmin
    .from("bluff_answers")
    .select("text")
    .eq("round_id", round.id);
  const dup = (existingAnswers ?? []).some((a) => normalize(a.text) === normalize(text));
  if (dup) {
    return NextResponse.json(
      { error: "Someone already submitted that. Try a different fake." },
      { status: 409 },
    );
  }

  // Upsert by (round_id, user_id): submitting again replaces the previous fake.
  const { data: existingMine } = await supabaseAdmin
    .from("bluff_answers")
    .select("id")
    .eq("round_id", round.id)
    .eq("user_id", userId)
    .eq("is_truth", false)
    .maybeSingle();

  if (existingMine) {
    await supabaseAdmin
      .from("bluff_answers")
      .update({ text })
      .eq("id", existingMine.id);
  } else {
    const { error } = await supabaseAdmin.from("bluff_answers").insert({
      round_id: round.id,
      user_id: userId,
      text,
      is_truth: false,
    });
    if (error) {
      console.error("[party/bluff/answer]", error.message);
      return NextResponse.json({ error: "Couldn't save answer" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
