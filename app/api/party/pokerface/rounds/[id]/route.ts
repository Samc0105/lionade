// GET /api/party/pokerface/rounds/[id] — phase-aware Poker Face round snapshot.
//
// This is the SANITIZED serve path for in-flight round content (the party-side
// analog of the competitive /match secret-stripping route + the bluff phase-aware
// GET). The party_pokerface_rounds table has its client SELECT revoked (migration
// 056), so the legitimate fetch path is THIS service-role route, which ships only
// the fields each viewer is allowed to see in the current phase:
//
//   phase='present':
//     - presenter: card_word + card_fact (so they can decide truth vs lie).
//     - everyone else: card_word only. NOT card_fact, NOT is_lie, NOT claim_text.
//   phase='interrogate' (live mode only — the grill before the vote):
//     - presenter: card_word + card_fact + is_lie (their own context).
//     - everyone else: card_word + interrogator id/name only. NOT card_fact/is_lie.
//   phase='vote':
//     - presenter: card_word + card_fact + their committed claim_text + is_lie.
//     - callers: card_word + claim_text (what was shown). NOT is_lie, NOT card_fact.
//   phase='reveal':
//     - everyone: full reveal (is_lie, card_fact, claim_text, all calls, points).
//
// Security: a caller can NEVER learn is_lie or the true card_fact before they
// have called and the round has been completed. userId comes from requireAuth.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { pokerFaceRoundPoints } from "@/lib/party/scoring";
import type { PokerFaceCall } from "@/lib/party/types";
import { isRoomMember } from "@/lib/party/room-state";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: round } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Membership check prevents leaking card/claim/is_lie state to non-members.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  const isPresenter = round.presenter_user_id === userId;

  // Presenter username (shown to the room).
  const { data: presenterProfile } = await supabaseAdmin
    .from("profiles")
    .select("username")
    .eq("id", round.presenter_user_id)
    .maybeSingle();

  // Active players → caller pool (everyone except the presenter) + count.
  // Ordered by joined_at so the interrogator (seat after the presenter) is
  // computed identically here, in the deal route, and in the open-vote route.
  const { data: activePlayers } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, joined_at, profiles!inner(username)")
    .eq("room_id", round.room_id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  const callerCount = Math.max(0, (activePlayers?.length ?? 1) - 1);

  // Interrogator = the active player seated right after the presenter (wrapping).
  // Null if there aren't enough players. Non-secret — shown to the whole room.
  const seatIds = (activePlayers ?? []).map((p) => p.user_id);
  const presenterIdx = seatIds.indexOf(round.presenter_user_id);
  const interrogatorUserId =
    seatIds.length >= 2 && presenterIdx !== -1
      ? seatIds[(presenterIdx + 1) % seatIds.length]
      : null;

  // This viewer's own call (if any).
  const { data: myCall } = await supabaseAdmin
    .from("party_pokerface_votes")
    .select("call")
    .eq("round_id", round.id)
    .eq("voter_user_id", userId)
    .maybeSingle();

  const base = {
    id: round.id,
    room_id: round.room_id,
    round_num: round.round_num,
    presenter_user_id: round.presenter_user_id,
    presenter_username: presenterProfile?.username ?? null,
    card_word: round.card_word,
    phase: round.phase as "present" | "interrogate" | "vote" | "reveal",
    started_at: round.started_at,
    presented_at: round.presented_at,
    ended_at: round.ended_at,
    my_call: (myCall?.call as PokerFaceCall | undefined) ?? null,
    caller_count: callerCount,
    is_presenter: isPresenter,
    interrogator_user_id: interrogatorUserId,
    interrogator_username: interrogatorUserId
      ? (() => {
          const p = (activePlayers ?? []).find((x) => x.user_id === interrogatorUserId) as
            | { profiles?: { username?: string } | { username?: string }[] }
            | undefined;
          const prof = p?.profiles;
          return (Array.isArray(prof) ? prof[0]?.username : prof?.username) ?? null;
        })()
      : null,
  };

  // ── present phase ──
  if (round.phase === "present") {
    return NextResponse.json({
      round: {
        ...base,
        // Presenter-only: the true fact so they can choose truth or invent a lie.
        card_fact: isPresenter ? round.card_fact : null,
      },
    });
  }

  // ── interrogate phase (live mode only) ──
  // The room grills the presenter out loud; no secret reaches a caller. The
  // presenter keeps their card_fact + is_lie on screen for context.
  if (round.phase === "interrogate") {
    return NextResponse.json({
      round: {
        ...base,
        is_lie: isPresenter ? round.is_lie : null,
        card_fact: isPresenter ? round.card_fact : null,
      },
    });
  }

  // Count calls so far (for the "N/M called" progress indicator).
  const { count: callsSoFar } = await supabaseAdmin
    .from("party_pokerface_votes")
    .select("voter_user_id", { count: "exact", head: true })
    .eq("round_id", round.id);

  // ── vote phase ──
  if (round.phase === "vote") {
    return NextResponse.json({
      round: {
        ...base,
        // Everyone sees the claim the presenter chose to show.
        claim_text: round.claim_text,
        // Presenter sees their own committed truth/lie + the true fact; callers
        // never learn is_lie / card_fact before reveal.
        is_lie: isPresenter ? round.is_lie : null,
        card_fact: isPresenter ? round.card_fact : null,
        call_count: callsSoFar ?? 0,
      },
    });
  }

  // ── reveal phase: full disclosure + per-round scoring breakdown ──
  const { data: calls } = await supabaseAdmin
    .from("party_pokerface_votes")
    .select("voter_user_id, call")
    .eq("round_id", round.id);

  const usernameById = new Map<string, string | null>();
  for (const p of activePlayers ?? []) {
    const prof = (p as { profiles?: { username?: string } | { username?: string }[] }).profiles;
    const uname = Array.isArray(prof) ? prof[0]?.username : prof?.username;
    usernameById.set((p as { user_id: string }).user_id, uname ?? null);
  }

  const isLie = round.is_lie === true;
  // Per-round points come from the shared helper (same math the authoritative
  // complete route banks, including the caught-red-handed penalty).
  const roundPoints = pokerFaceRoundPoints(
    isLie,
    (calls ?? []).map((c) => ({ voter_user_id: c.voter_user_id, call: c.call as "believe" | "doubt" })),
    round.presenter_user_id,
  );
  const callDetails = (calls ?? []).map((c) => ({
    user_id: c.voter_user_id,
    username: usernameById.get(c.voter_user_id) ?? null,
    call: c.call as PokerFaceCall,
    // A caller is CORRECT when they doubt a lie or believe a truth.
    correct: (c.call === "doubt" && isLie) || (c.call === "believe" && !isLie),
  }));

  return NextResponse.json({
    round: {
      ...base,
      claim_text: round.claim_text,
      is_lie: round.is_lie,
      card_fact: round.card_fact,
      reveal: {
        is_lie: round.is_lie,
        card_fact: round.card_fact,
        claim_text: round.claim_text,
        calls: callDetails,
        round_points: roundPoints,
      },
    },
  });
}
