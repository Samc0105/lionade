// Shared Poker Face phase-advance + scoring.
//
// SINGLE SOURCE OF TRUTH for "flip a Poker Face round out of its current phase
// when its (client-mirrored) server deadline has passed, and (on ->reveal)
// score it exactly once." Callers:
//   - app/api/party/pokerface/rounds/[id]/route.ts (GET) — server-side lazy
//     advance on read. EVERY client polls this GET every ~1.5s, so a stuck
//     round self-heals on the next poll even if the presenter AND the host AND
//     the interrogator all have their tabs backgrounded (throttled timers).
//   - the present/open-vote/complete POST routes remain the client-driven fast
//     path; this helper is the resilience backstop, not a replacement.
//
// Mirrors lib/party/bluff-advance.ts + lib/party/trivia-advance.ts. The whole
// reason this lives in one helper: the vote->reveal transition ADDS score
// deltas to running scores, so it must run exactly once. The transition is a
// compare-and-swap (UPDATE ... WHERE phase = <from>); only the single caller
// whose CAS actually flips the row runs scoring. Even if a GET lazy-advance and
// the host's /complete POST race, the DB guarantees one winner — the loser's
// update affects 0 rows and it skips scoring.
//
// WHY the server has no deadline columns: Poker Face never persisted phase
// deadlines (no *_ends_at). The windows are derived from started_at /
// presented_at + the SAME constants the client timers use, so server and client
// agree on when each phase has expired. These constants are duplicated from
// PokerFaceView's COUNTDOWN_SECONDS / DECIDE_SECONDS / READ_BACKSTOP_SECONDS /
// DEFAULT_CALL_SECONDS — keep them in sync if the client windows change.

import type { SupabaseClient } from "@supabase/supabase-js";
import { pokerFaceRoundPoints } from "@/lib/party/scoring";

// ── Phase-window constants (mirror PokerFaceView) ──────────────────────────
// present:  the presenter reads the card + picks truth/lie. Window measured
//           from started_at, padded by the between-rounds countdown overlay.
const COUNTDOWN_SECONDS = 5;
const DECIDE_SECONDS = 30;
// interrogate (in-person only): the "read it out loud" beat before calling.
const READ_BACKSTOP_SECONDS = 25;
// vote: the believe/doubt call window. Room setting pf_vote_seconds overrides.
const DEFAULT_CALL_SECONDS = 15;
// Grace pad added to every server-side deadline before the lazy-advance fires,
// so the GET backstop never beats the client's own timer in the common case
// (the client advance stays the fast path; this only catches genuinely-stuck
// rounds where every privileged client is backgrounded).
const GRACE_MS = 3_000;

export type PokerFacePhase = "present" | "interrogate" | "vote" | "reveal";

export interface PokerFaceAdvanceResult {
  /** The phase the round is in AFTER this call. */
  phase: PokerFacePhase;
  /** True only when THIS call won a CAS and actually flipped the row. */
  advanced: boolean;
}

interface RoundRow {
  id: string;
  room_id: string;
  presenter_user_id: string;
  phase: string;
  is_lie: boolean | null;
  card_fact: string;
  claim_text: string | null;
  started_at: string | null;
  presented_at: string | null;
}

/**
 * If `round` is past the server-side deadline for its current phase, advance it
 * one step, CAS-guarded. Safe to call on every GET: a not-yet-expired round, or
 * a round already in `reveal`, is a no-op.
 *
 *   present     -> interrogate|vote  (after started_at + COUNTDOWN + DECIDE)
 *                  Auto-locks TRUTH on the presenter's behalf — exactly what the
 *                  presenter's own client backstop does on decide-window expiry.
 *   interrogate -> vote              (after presented_at + READ_BACKSTOP)
 *   vote        -> reveal            (after presented_at + callSeconds; SCORES once)
 *
 * `inperson` + `callSeconds` come from the room settings (the GET route already
 * loads the round; the caller passes the room's pf_mode + pf_vote_seconds).
 * Returns whether THIS caller won a transition.
 */
export async function lazyAdvancePokerFace(
  supabase: SupabaseClient,
  round: RoundRow,
  opts: { inperson: boolean; callSeconds: number | null | undefined },
): Promise<PokerFaceAdvanceResult> {
  const phase = round.phase as PokerFacePhase;
  const now = Date.now();

  // ── present -> (interrogate | vote): auto-lock TRUTH for a stalled presenter ──
  if (phase === "present") {
    if (!round.started_at) return { phase, advanced: false };
    const deadline =
      new Date(round.started_at).getTime() +
      (COUNTDOWN_SECONDS + DECIDE_SECONDS) * 1000 +
      GRACE_MS;
    if (now < deadline) return { phase, advanced: false };

    // Mirror the present route's truth path: a TRUTH claim is FORCED to the
    // card's real fact (remote) or stays null (in-person, spoken). is_lie=false
    // is the safe server default — we never invent a lie on the presenter's
    // behalf. CAS on phase='present' so a real present POST that lands first
    // wins and this no-ops.
    const nextPhase: PokerFacePhase = opts.inperson ? "interrogate" : "vote";
    const claimText = opts.inperson ? null : round.card_fact;
    const { data: flipped } = await supabase
      .from("party_pokerface_rounds")
      .update({
        is_lie: false,
        claim_text: claimText,
        phase: nextPhase,
        presented_at: new Date().toISOString(),
      })
      .eq("id", round.id)
      .eq("phase", "present")
      .select("id");
    return { phase: nextPhase, advanced: !!(flipped && flipped.length > 0) };
  }

  // ── interrogate -> vote: open calling for a stalled read beat ──
  if (phase === "interrogate") {
    if (!round.presented_at) return { phase, advanced: false };
    const deadline =
      new Date(round.presented_at).getTime() + READ_BACKSTOP_SECONDS * 1000 + GRACE_MS;
    if (now < deadline) return { phase, advanced: false };

    // Reset presented_at = now so the vote window starts fresh, mirroring the
    // open-vote route. CAS on phase='interrogate'.
    const { data: flipped } = await supabase
      .from("party_pokerface_rounds")
      .update({ phase: "vote", presented_at: new Date().toISOString() })
      .eq("id", round.id)
      .eq("phase", "interrogate")
      .select("id");
    return { phase: "vote", advanced: !!(flipped && flipped.length > 0) };
  }

  // ── vote -> reveal: close calling + score exactly once ──
  if (phase === "vote") {
    if (!round.presented_at) return { phase, advanced: false };
    if (round.is_lie === null || round.is_lie === undefined) {
      // Defensive: a vote-phase round must have a committed is_lie. If not,
      // don't score — leave it for a real present to repair.
      return { phase, advanced: false };
    }
    const callSeconds = opts.callSeconds ?? DEFAULT_CALL_SECONDS;
    const deadline =
      new Date(round.presented_at).getTime() + callSeconds * 1000 + GRACE_MS;
    if (now < deadline) return { phase, advanced: false };

    const { data: claimed } = await supabase
      .from("party_pokerface_rounds")
      .update({ phase: "reveal", ended_at: new Date().toISOString() })
      .eq("id", round.id)
      .eq("phase", "vote")
      .select("id");
    if (claimed && claimed.length > 0) {
      // We won the flip — calls are frozen (the call route rejects phase!='vote'),
      // so scoring runs exactly once. Same math the /complete route banks + the
      // reveal GET previews.
      await scorePokerFaceRound(supabase, round);
      return { phase: "reveal", advanced: true };
    }
    return { phase: "reveal", advanced: false };
  }

  // reveal (or anything else): terminal — nothing to advance.
  return { phase, advanced: false };
}

/** Compute and persist score deltas for a finished Poker Face round.
 *  MUST only be called by the single CAS winner of the vote->reveal transition —
 *  it ADDS deltas to running scores, so a second invocation would double-count.
 *  The CAS guard in lazyAdvancePokerFace (and the /complete route) enforces this. */
async function scorePokerFaceRound(
  supabase: SupabaseClient,
  round: Pick<RoundRow, "id" | "room_id" | "presenter_user_id" | "is_lie">,
): Promise<void> {
  const isLie = round.is_lie === true;
  const { data: calls } = await supabase
    .from("party_pokerface_votes")
    .select("voter_user_id, call")
    .eq("round_id", round.id);

  const deltas = pokerFaceRoundPoints(
    isLie,
    (calls ?? []).map((c) => ({
      voter_user_id: c.voter_user_id as string,
      call: c.call as "believe" | "doubt",
    })),
    round.presenter_user_id,
  );

  // Apply deltas to party_room_players.score (read-modify-write per player,
  // matching the /complete route). We do NOT floor at 0 — the caught-red-handed
  // penalty is allowed to push a presenter negative so banked == previewed.
  for (const [uid, delta] of Object.entries(deltas)) {
    if (delta === 0) continue;
    const { data: row } = await supabase
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (!row) continue;
    await supabase
      .from("party_room_players")
      .update({ score: (row.score ?? 0) + delta })
      .eq("room_id", round.room_id)
      .eq("user_id", uid);
  }
}
