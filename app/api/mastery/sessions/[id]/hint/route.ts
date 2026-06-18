import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/mastery/sessions/[id]/hint
 *
 * Body: { challengeToken: string, eliminated?: number[] }
 *
 * Spends ONE Mastery Hint (granted by buying boost_mastery_hint_pack) to
 * eliminate one wrong option on the question currently in flight. The server
 * owns the correct answer, so the client never learns it — it only receives a
 * WRONG option index to grey out. We always leave at least the correct option
 * plus one wrong option (a 50/50 floor), so a 4-option question allows up to 2
 * hints.
 *
 * The hint counter (profiles.mastery_hints_remaining) is decremented atomically
 * via the service-role consume_mastery_hint RPC; it returns -1 when the user has
 * none, which we map to 400.
 *
 * Response: { eliminatedIndex, eliminated: number[], hintsRemaining }
 */

type RouteCtx = { params: { id: string } };

interface PendingQuestion {
  type: "question";
  questionId: string;
  challengeToken: string;
  subtopicId?: string;
  // Server-owned record of which option indices have been eliminated by hints
  // on THIS question, so the 50/50 floor + dedup can't be bypassed by a client
  // lying about what it has already removed. Reset whenever /next sets a new
  // pending question.
  eliminated?: number[];
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const sessionId = params.id;

  let body: { challengeToken?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const token = String(body.challengeToken ?? "");
  if (!token) return NextResponse.json({ error: "Missing challengeToken" }, { status: 400 });

  try {
    const { data: sessionRow } = await supabaseAdmin
      .from("mastery_sessions")
      .select("id, user_id, status, runtime_state")
      .eq("id", sessionId)
      .single();

    if (!sessionRow || sessionRow.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (sessionRow.status !== "active") {
      return NextResponse.json({ error: "Session is not active" }, { status: 409 });
    }

    // Validate the challenge token against the server's pending question — same
    // contract as /answer, so a hint can't be used on a stale or spoofed question.
    const runtime = (sessionRow.runtime_state ?? {}) as Record<string, unknown> & {
      pending?: PendingQuestion | null;
    };
    const pending = runtime.pending ?? null;
    if (!pending || pending.type !== "question" || pending.challengeToken !== token) {
      return NextResponse.json({ error: "No pending question or token mismatch" }, { status: 409 });
    }
    // Server-owned eliminated set — NEVER trust the client for the floor/dedup.
    const serverEliminated = Array.isArray(pending.eliminated) ? pending.eliminated : [];

    // Load the question server-side; correct_index is never sent to the client.
    const { data: q } = await supabaseAdmin
      .from("mastery_questions")
      .select("id, options, correct_index")
      .eq("id", pending.questionId)
      .single();
    if (!q) return NextResponse.json({ error: "Question missing" }, { status: 500 });

    const optionCount = Array.isArray(q.options) ? q.options.length : 4;
    // Always leave the correct option + at least one wrong option.
    const maxEliminations = Math.max(0, optionCount - 2);
    if (serverEliminated.length >= maxEliminations) {
      return NextResponse.json(
        { error: "No more hints can be used on this question" },
        { status: 409 },
      );
    }

    // Candidate wrong options not already eliminated (server record).
    const wrong: number[] = [];
    for (let i = 0; i < optionCount; i++) {
      if (i !== q.correct_index && !serverEliminated.includes(i)) wrong.push(i);
    }
    if (wrong.length === 0) {
      return NextResponse.json({ error: "Nothing to eliminate" }, { status: 409 });
    }
    // Deterministic pick (varies with token + how many are already gone) so it
    // is not always the first option, without needing randomness in the route.
    const pickIdx = wrong[(token.length + serverEliminated.length) % wrong.length];

    // Spend one hint atomically. -1 = the user has none (no decrement happened).
    const { data: remaining, error: consumeErr } = await supabaseAdmin.rpc(
      "consume_mastery_hint",
      { p_user_id: userId },
    );
    if (consumeErr) {
      console.error("[mastery/hint] consume:", consumeErr.message);
      return NextResponse.json({ error: "Hints unavailable" }, { status: 500 });
    }
    if (typeof remaining !== "number" || remaining < 0) {
      return NextResponse.json({ error: "No hints left" }, { status: 400 });
    }

    // Persist the elimination into the pending question so the floor + dedup are
    // server-authoritative across calls (best-effort: the client also receives
    // the set in the response, so a write failure doesn't lose this hint's UI).
    const newEliminated = [...serverEliminated, pickIdx];
    runtime.pending = { ...pending, eliminated: newEliminated };
    await supabaseAdmin
      .from("mastery_sessions")
      .update({ runtime_state: runtime })
      .eq("id", sessionId);

    return NextResponse.json({
      eliminatedIndex: pickIdx,
      eliminated: newEliminated,
      hintsRemaining: remaining,
    });
  } catch (e) {
    console.error("[mastery/sessions/:id/hint]", e);
    return NextResponse.json({ error: "Couldn't use a hint" }, { status: 500 });
  }
}
