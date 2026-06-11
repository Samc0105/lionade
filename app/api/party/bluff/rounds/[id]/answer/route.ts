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
import { isRoomMember } from "@/lib/party/room-state";
import { isForfeitText } from "@/lib/party/bluff-constants";

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

  // Membership check prevents cross-room round-id leaks polluting another game.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Reject if the fake is the truth.
  if (normalize(text) === normalize(round.correct_answer)) {
    return NextResponse.json(
      { error: "That's the real answer. Try a different fake." },
      { status: 400 },
    );
  }

  // Reject duplicates of an existing answer in this round (case-insensitive).
  // Forfeit sentinels are exempt: multiple players may sit the same round out,
  // and without this exemption the SECOND forfeiter got a 409 ("Someone
  // already submitted that") and couldn't forfeit at all.
  if (!isForfeitText(text)) {
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
    return NextResponse.json({ ok: true });
  }

  // First fake from this user this round. Insert first; recover on a unique
  // violation (23505) instead of pre-emptively shuffling rows around:
  //
  //   (a) Double-submit race: a parallel request from this same user landed
  //       first → treat as an edit (update the text) and return ok.
  //   (b) Legacy `UNIQUE (round_id, user_id)` databases (pre-
  //       20260605230000_bluff_answers_truth_fake_coexist): the truth row may
  //       sit under THIS user's id as an FK placeholder, blocking their fake.
  //       Re-point the truth row to an active member with NO rows in this
  //       round (the old code picked ANY other member — if that member had
  //       already submitted, the re-point silently violated the same unique
  //       key, its error was never checked, and this user's insert 500'd:
  //       in a 2-player room the truth-owner could NEVER submit).
  const doInsert = () =>
    supabaseAdmin.from("bluff_answers").insert({
      round_id: round.id,
      user_id: userId,
      text,
      is_truth: false,
    });

  let { error: insertErr } = await doInsert();

  if (insertErr && insertErr.code === "23505") {
    // (a) Our fake actually exists now (parallel submit) → update it.
    const { data: mine } = await supabaseAdmin
      .from("bluff_answers")
      .select("id")
      .eq("round_id", round.id)
      .eq("user_id", userId)
      .eq("is_truth", false)
      .maybeSingle();
    if (mine) {
      await supabaseAdmin.from("bluff_answers").update({ text }).eq("id", mine.id);
      return NextResponse.json({ ok: true });
    }

    // (b) Truth-row collision on a legacy-constraint database.
    const { data: truthRow } = await supabaseAdmin
      .from("bluff_answers")
      .select("id")
      .eq("round_id", round.id)
      .eq("user_id", userId)
      .eq("is_truth", true)
      .maybeSingle();
    if (truthRow) {
      const [{ data: members }, { data: takenRows }] = await Promise.all([
        supabaseAdmin
          .from("party_room_players")
          .select("user_id")
          .eq("room_id", round.room_id)
          .is("left_at", null)
          .neq("user_id", userId),
        supabaseAdmin
          .from("bluff_answers")
          .select("user_id")
          .eq("round_id", round.id),
      ]);
      const taken = new Set((takenRows ?? []).map((r) => r.user_id));
      const candidate = (members ?? []).find((m) => !taken.has(m.user_id));
      if (candidate) {
        const { error: repointErr } = await supabaseAdmin
          .from("bluff_answers")
          .update({ user_id: candidate.user_id })
          .eq("id", truthRow.id);
        if (!repointErr) {
          ({ error: insertErr } = await doInsert());
        }
      }
    }
  }

  if (insertErr) {
    console.error("[party/bluff/answer]", insertErr.message);
    return NextResponse.json({ error: "Couldn't save answer" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
