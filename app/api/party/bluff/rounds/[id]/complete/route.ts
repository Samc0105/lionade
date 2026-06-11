// POST /api/party/bluff/rounds/[id]/complete — advance phase / end round.
//
// Body: { action?: "advance" | "end", from_phase?: "write" | "vote" }
//   (action defaults to "advance")
//
// Behavior:
//   - "advance":
//       write  -> vote   (set vote_ends_at)
//       vote   -> reveal (compute + persist score deltas)
//       reveal -> noop   (return 200 — and NEVER re-score)
//   - "end": force phase='reveal' + ended_at (host fallback for stuck rounds).
//
// Who may call it:
//   - The effective host (stored host, or the longest-connected active player
//     when the stored host has dropped) — anytime.
//   - ANY active room member — but only for "advance", and only once the
//     current phase's server-side deadline (write_ends_at / vote_ends_at) has
//     passed by >= GRACE. This is the stuck-state fallback: if the effective
//     host's tab is backgrounded (browser timer throttling) or asleep, any
//     player whose local timer expired can unstick the room.
//
// Idempotency / race safety (multiple clients WILL race this on purpose):
//   - `from_phase` is a stale-intent guard: a client that meant "advance out
//     of write" can't accidentally advance vote->reveal when its POST lands
//     late (this exact double-fire used to skip the vote phase entirely).
//   - Every transition is a compare-and-swap: UPDATE ... WHERE phase = <from>.
//     Only the single caller whose CAS actually flips the row runs scoring,
//     so racing advancers can never double-apply score deltas.
//   - phase='reveal' is terminal: any further call is a pure no-op.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { BLUFF_TRUTH_POINTS, BLUFF_FAKE_TRICK_POINTS } from "@/lib/party/scoring";
import { isEffectiveHost, isRoomMember } from "@/lib/party/room-state";

const DEFAULT_VOTE_SECONDS = 30;
// How far past the phase deadline a NON-host member must wait before their
// advance is accepted. Soaks up clock skew so an early client can't shorten
// the phase for everyone.
const MEMBER_ADVANCE_GRACE_MS = 3_000;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const action: "advance" | "end" = body?.action === "end" ? "end" : "advance";
  const fromPhase: string | null =
    body?.from_phase === "write" || body?.from_phase === "vote" ? body.from_phase : null;

  const { data: round } = await supabaseAdmin
    .from("bluff_rounds")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("host_user_id, settings")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // ── Permission ──
  const hostAllowed = await isEffectiveHost(
    supabaseAdmin,
    round.room_id,
    room.host_user_id,
    userId,
  );
  let allowed = hostAllowed;
  if (!allowed && action === "advance") {
    // Deadline-passed fallback: any active member may advance a phase whose
    // server-side timer has expired (plus grace). "end" stays host-only.
    if (await isRoomMember(supabaseAdmin, round.room_id, userId)) {
      if (round.phase === "reveal") {
        allowed = true; // terminal no-op below — harmless
      } else {
        const deadline =
          round.phase === "write" ? round.write_ends_at : round.vote_ends_at;
        if (
          deadline &&
          Date.now() - new Date(deadline).getTime() >= MEMBER_ADVANCE_GRACE_MS
        ) {
          allowed = true;
        }
      }
    }
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "Only the host can advance phases right now" },
      { status: 403 },
    );
  }

  // ── Terminal: a revealed round never transitions (and NEVER re-scores) ──
  if (round.phase === "reveal") {
    return NextResponse.json({ ok: true, phase: "reveal", advanced: false });
  }

  // ── Stale-intent guard ──
  // The client tells us which phase it believes it's advancing OUT of. If the
  // round has already moved on (another client won the race), no-op instead of
  // advancing a second time (write->vote->reveal in one tick skipped voting).
  if (action === "advance" && fromPhase && fromPhase !== round.phase) {
    return NextResponse.json({ ok: true, phase: round.phase, advanced: false });
  }

  // ── Force-end: CAS from any non-reveal phase straight to reveal ──
  if (action === "end") {
    const { data: flipped } = await supabaseAdmin
      .from("bluff_rounds")
      .update({ phase: "reveal", ended_at: new Date().toISOString() })
      .eq("id", round.id)
      .neq("phase", "reveal")
      .select("id");
    if (flipped && flipped.length > 0) {
      // We won the transition — votes are frozen (vote route rejects when
      // phase != 'vote'), so scoring here is applied exactly once.
      await scoreRound(round.id);
    }
    return NextResponse.json({ ok: true, phase: "reveal" });
  }

  if (round.phase === "write") {
    const voteSeconds = room.settings?.vote_seconds ?? DEFAULT_VOTE_SECONDS;
    const voteEndsAt = new Date(Date.now() + voteSeconds * 1000).toISOString();
    const { data: flipped } = await supabaseAdmin
      .from("bluff_rounds")
      .update({ phase: "vote", vote_ends_at: voteEndsAt })
      .eq("id", round.id)
      .eq("phase", "write")
      .select("id");
    if (!flipped || flipped.length === 0) {
      // Lost the race — report whatever the round is now.
      const { data: now } = await supabaseAdmin
        .from("bluff_rounds")
        .select("phase")
        .eq("id", round.id)
        .maybeSingle();
      return NextResponse.json({ ok: true, phase: now?.phase ?? "vote", advanced: false });
    }
    return NextResponse.json({ ok: true, phase: "vote", vote_ends_at: voteEndsAt });
  }

  if (round.phase === "vote") {
    const { data: flipped } = await supabaseAdmin
      .from("bluff_rounds")
      .update({ phase: "reveal", ended_at: new Date().toISOString() })
      .eq("id", round.id)
      .eq("phase", "vote")
      .select("id");
    if (flipped && flipped.length > 0) {
      await scoreRound(round.id);
    }
    return NextResponse.json({ ok: true, phase: "reveal" });
  }

  return NextResponse.json({ ok: true, phase: round.phase });
}

/** Compute and persist score deltas for a finished bluff round.
 *  MUST only be called by the single CAS winner of the ->reveal transition —
 *  it adds deltas to running scores, so a second invocation double-counts. */
async function scoreRound(roundId: string): Promise<void> {
  const { data: round } = await supabaseAdmin
    .from("bluff_rounds")
    .select("room_id, correct_answer")
    .eq("id", roundId)
    .maybeSingle();
  if (!round) return;

  const { data: answers } = await supabaseAdmin
    .from("bluff_answers")
    .select("id, user_id, is_truth")
    .eq("round_id", roundId);
  const { data: votes } = await supabaseAdmin
    .from("bluff_votes")
    .select("answer_id, voter_user_id")
    .eq("round_id", roundId);

  const answerById = new Map<string, { user_id: string; is_truth: boolean }>();
  (answers ?? []).forEach((a) => answerById.set(a.id, { user_id: a.user_id, is_truth: a.is_truth }));

  const deltas: Map<string, number> = new Map();
  (votes ?? []).forEach((v) => {
    const answer = answerById.get(v.answer_id);
    if (!answer) return;
    if (answer.is_truth) {
      // Voter picked the truth → +1000 for voter.
      deltas.set(v.voter_user_id, (deltas.get(v.voter_user_id) ?? 0) + BLUFF_TRUTH_POINTS);
    } else {
      // Voter picked a fake → +500 for the fake's author (the bluffer).
      deltas.set(answer.user_id, (deltas.get(answer.user_id) ?? 0) + BLUFF_FAKE_TRICK_POINTS);
    }
  });

  // Apply deltas to party_room_players.
  const entries = Array.from(deltas.entries());
  for (const [uid, delta] of entries) {
    if (delta === 0) continue;
    const { data: row } = await supabaseAdmin
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (!row) continue;
    await supabaseAdmin
      .from("party_room_players")
      .update({ score: (row.score ?? 0) + delta })
      .eq("room_id", round.room_id)
      .eq("user_id", uid);
  }
}
