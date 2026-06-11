// POST /api/party/trivia/rounds/[id]/complete — advance phase.
//
// Body: { action?: "advance", from_phase?: "answer" | "reveal" }
//   (action defaults to "advance")
//
// Behavior:
//   - "advance":
//       answer -> reveal (compute + persist score deltas exactly once)
//       reveal -> ended  (stamp ended_at; reveal is terminal for the round)
//
// Who may call it (mirrors bluff complete):
//   - The effective host (stored host, or the longest-connected active player
//     when the stored host has dropped) — anytime.
//   - ANY active room member — but only once the current phase's server-side
//     deadline (answer_ends_at / reveal_ends_at) has passed by >= GRACE. This
//     is the stuck-state fallback: a backgrounded host whose setTimeout is
//     throttled can't freeze the room — any player whose timer expired unsticks
//     it.
//
// Idempotency / race safety:
//   - `from_phase` is a stale-intent guard so a late POST can't skip a phase.
//   - Every transition is a CAS (UPDATE ... WHERE phase = <from>); only the
//     single winner runs scoring, so racing advancers never double-apply.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isEffectiveHost, isRoomMember } from "@/lib/party/room-state";
import { advanceTriviaPhase, publicOptions } from "@/lib/party/trivia-advance";

// How far past the phase deadline a NON-host member must wait before their
// advance is accepted. Soaks up clock skew (mirrors bluff complete).
const MEMBER_ADVANCE_GRACE_MS = 3_000;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const fromPhase: string | null =
    body?.from_phase === "answer" || body?.from_phase === "reveal"
      ? body.from_phase
      : null;

  const { data: round } = await supabaseAdmin
    .from("trivia_rounds")
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

  // ── Terminal: an ended round never transitions ──
  if (round.ended_at != null) {
    return NextResponse.json({
      advanced: false,
      round: buildRoundPayload(round),
    });
  }

  // ── Permission ──
  const hostAllowed = await isEffectiveHost(
    supabaseAdmin,
    round.room_id,
    room.host_user_id,
    userId,
  );
  let allowed = hostAllowed;
  if (!allowed) {
    // Deadline-passed fallback: any active member may advance a phase whose
    // server-side timer has expired (plus grace).
    if (await isRoomMember(supabaseAdmin, round.room_id, userId)) {
      const deadline =
        round.phase === "answer" ? round.answer_ends_at : round.reveal_ends_at;
      if (
        deadline &&
        Date.now() - new Date(deadline).getTime() >= MEMBER_ADVANCE_GRACE_MS
      ) {
        allowed = true;
      }
    }
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "Only the host can advance phases right now" },
      { status: 403 },
    );
  }

  // ── Stale-intent guard ──
  // The client tells us which phase it believes it's advancing OUT of. If the
  // round already moved on (another client won the race), no-op.
  if (fromPhase && fromPhase !== round.phase) {
    return NextResponse.json({
      advanced: false,
      round: buildRoundPayload(round),
    });
  }

  // ── Single-step advance (shared with the GET lazy-advance path) ──
  // advanceTriviaPhase is CAS-guarded and runs scoring exactly once on the
  // answer->reveal flip, so it's safe to race against the GET self-heal.
  const result = await advanceTriviaPhase(
    supabaseAdmin,
    round.id,
    round.phase as "answer" | "reveal",
    room.settings?.trivia_reveal_seconds,
  );

  // Re-read so the payload reflects the post-advance phase + deadlines.
  const { data: fresh } = await supabaseAdmin
    .from("trivia_rounds")
    .select("*")
    .eq("id", round.id)
    .maybeSingle();
  const finalRound = fresh ?? round;

  return NextResponse.json({
    advanced: result.advanced,
    round: buildRoundPayload(finalRound),
  });
}

// Phase-aware round payload. correct_option_id only ships once phase==='reveal'.
function buildRoundPayload(round: {
  id: string;
  room_id: string;
  round_num: number;
  question: string;
  category: string | null;
  phase: string;
  started_at: string;
  answer_ends_at: string | null;
  reveal_ends_at: string | null;
  ended_at: string | null;
  options: unknown;
  correct_index: number;
}) {
  const payload: {
    id: string;
    room_id: string;
    round_num: number;
    question: string;
    category: string | null;
    phase: string;
    started_at: string;
    answer_ends_at: string | null;
    reveal_ends_at: string | null;
    ended_at: string | null;
    options: { id: string; text: string }[];
    correct_option_id?: string;
  } = {
    id: round.id,
    room_id: round.room_id,
    round_num: round.round_num,
    question: round.question,
    category: round.category,
    phase: round.phase,
    started_at: round.started_at,
    answer_ends_at: round.answer_ends_at,
    reveal_ends_at: round.reveal_ends_at,
    ended_at: round.ended_at,
    options: publicOptions(round.options),
  };
  if (round.phase === "reveal") {
    payload.correct_option_id = String(round.correct_index);
  }
  return payload;
}
