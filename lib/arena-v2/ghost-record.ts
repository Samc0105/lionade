import { supabaseAdmin } from "@/lib/supabase-server";
import type { GhostAnswer } from "@/lib/arena-v2/ghost-matcher";

/**
 * Record a completed live-duel run as a future ghost, CONSENT-GATED. Called
 * (behind the Arena V2 flag) after a live duel settles, once per player who has
 * opted in (profiles.ghost_consent_at IS NOT NULL). The recorded run is what a
 * future challenger replays against.
 *
 * Service-role only (duel_ghosts has no client write policy). Best-effort and
 * fail-soft: a failure here never affects the match outcome. Idempotent per
 * (owner, match) via a pre-check on the recorded question set + owner within a
 * short window — a retried settle won't double-insert.
 */
export async function recordGhostFromMatch(opts: {
  matchId: string;
  ownerUserId: string;
  eloBefore: number;
  subject: string | null;
}): Promise<void> {
  const { matchId, ownerUserId, eloBefore, subject } = opts;
  try {
    if (!subject) return; // no subject lock → not a V2-shaped match, skip.

    // Consent gate: only record ghosts for users who opted in.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("ghost_consent_at")
      .eq("id", ownerUserId)
      .maybeSingle();
    if (!profile?.ghost_consent_at) return;

    // Pull this player's answers for the match.
    const { data: rows } = await supabaseAdmin
      .from("arena_answers")
      .select("question_id, selected_answer, response_time_ms, is_correct")
      .eq("match_id", matchId)
      .eq("user_id", ownerUserId);
    if (!rows || rows.length === 0) return;

    const answers: GhostAnswer[] = rows.map((r: any) => ({
      question_id: r.question_id,
      selected_index: r.selected_answer ?? -1,
      time_ms: r.response_time_ms ?? 0,
      correct: !!r.is_correct,
    }));
    const questionIds = answers.map((a) => a.question_id);
    const totalScore = rows.reduce((s: number, r: any) => s + (r.is_correct ? 1 : 0), 0);

    // Idempotency: skip if this exact run (owner + first question id) was already
    // recorded in the last hour (a retried settle re-firing recordGhost).
    const { data: existing } = await supabaseAdmin
      .from("duel_ghosts")
      .select("id")
      .eq("owner_user_id", ownerUserId)
      .contains("question_ids", [questionIds[0]])
      .gte("recorded_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await supabaseAdmin.from("duel_ghosts").insert({
      owner_user_id: ownerUserId,
      subject,
      elo_at_recording: eloBefore,
      question_ids: questionIds,
      answers,
      total_score: totalScore,
      is_trainer: false,
    });
  } catch (e) {
    // Fail-soft — ghost recording must never affect the settled match.
    console.warn("[arena-v2] recordGhostFromMatch:", e instanceof Error ? e.message : "unknown");
  }
}
