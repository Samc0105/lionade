// Arena V2 — ghost replay playback engine.
//
// GET ?ghostId=...&questionIndex=N&elapsedMs=M
//
// Behavior: returns what the ghost did at this point in the question.
//   - If the ghost's recorded answer for question N has time_ms <= elapsedMs:
//       → return { status: "answered", selected_index, time_ms, correct }
//   - Otherwise:
//       → return { status: "still_thinking" }
//
// The client polls this every ~250ms during the duel so the HP bar can
// animate damage at the exact moment the ghost "answered."
//
// Anti-cheat: we do NOT return correct_answer. We only return what the
// ghost selected and whether THAT selection was correct.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/feature-flag";

interface GhostAnswerRow {
  question_id: string;
  selected_index: number;
  time_ms: number;
  correct: boolean;
}

export async function GET(req: NextRequest) {
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ error: "Arena V2 disabled" }, { status: 404 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const ghostId = req.nextUrl.searchParams.get("ghostId");
    const questionIndexRaw = req.nextUrl.searchParams.get("questionIndex");
    const elapsedMsRaw = req.nextUrl.searchParams.get("elapsedMs");

    if (!ghostId) {
      return NextResponse.json({ error: "Missing ghostId" }, { status: 400 });
    }
    const questionIndex = Number(questionIndexRaw);
    const elapsedMs = Number(elapsedMsRaw);
    if (!Number.isFinite(questionIndex) || questionIndex < 0) {
      return NextResponse.json({ error: "Invalid questionIndex" }, { status: 400 });
    }
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      return NextResponse.json({ error: "Invalid elapsedMs" }, { status: 400 });
    }

    const { data: ghost, error } = await supabaseAdmin
      .from("duel_ghosts")
      .select("id, question_ids, answers, is_trainer")
      .eq("id", ghostId)
      .single();

    if (error || !ghost) {
      return NextResponse.json({ error: "Ghost not found" }, { status: 404 });
    }

    const answers = (ghost.answers ?? []) as GhostAnswerRow[];
    const qid = (ghost.question_ids ?? [])[questionIndex];
    if (!qid) {
      return NextResponse.json({ error: "Question index out of range" }, { status: 400 });
    }

    // Locate ghost's answer for this question.
    const recorded = answers.find((a) => a.question_id === qid);
    if (!recorded) {
      // Ghost skipped / timed out on this question.
      return NextResponse.json({ status: "skipped" });
    }

    if (recorded.time_ms > elapsedMs) {
      return NextResponse.json({ status: "still_thinking" });
    }

    return NextResponse.json({
      status: "answered",
      selected_index: recorded.selected_index,
      time_ms: recorded.time_ms,
      correct: recorded.correct,
    });
  } catch (e) {
    console.error("[arena/v2/ghost-replay]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
