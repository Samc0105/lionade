import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * Ghost matcher for async arena duels. When the live queue has no opponent, we
 * match the player against a RECORDED ghost run so the arena is never empty.
 * Runs server-side on supabaseAdmin (bypasses the duel_ghosts RLS, which only
 * allows non-owner SELECT to authed clients anyway).
 */

export interface GhostAnswer {
  question_id: string;
  selected_index: number;
  time_ms: number;
  correct: boolean;
}

export interface GhostRow {
  id: string;
  owner_user_id: string;
  subject: string;
  elo_at_recording: number;
  question_ids: string[];
  answers: GhostAnswer[];
  total_score: number;
  is_trainer: boolean;
}

const ELO_BAND = 300;
const GHOST_COLS =
  "id, owner_user_id, subject, elo_at_recording, question_ids, answers, total_score, is_trainer";

function normalizeGhost(row: any): GhostRow {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    subject: row.subject,
    elo_at_recording: row.elo_at_recording ?? 1000,
    question_ids: (row.question_ids ?? []) as string[],
    answers: (typeof row.answers === "string" ? JSON.parse(row.answers) : (row.answers ?? [])) as GhostAnswer[],
    total_score: row.total_score ?? 0,
    is_trainer: row.is_trainer ?? false,
  };
}

/** Of a candidate set, pick the ghost whose recorded ELO is nearest the player. */
function nearestByElo(rows: any[], elo: number): any {
  return rows
    .slice()
    .sort((a, b) => Math.abs((a.elo_at_recording ?? 1000) - elo) - Math.abs((b.elo_at_recording ?? 1000) - elo))[0];
}

/**
 * Find a ghost to duel against. Cascade:
 *   1. A REAL player's ghost — same subject, ELO within ±300, recorded within
 *      24h, not owned by the caller, non-trainer. Then widen the recency window
 *      to 7d.
 *   2. Fall back to a Trainer Ninny seed ghost (nearest ELO in the subject) so
 *      a brand-new / low-traffic arena is never empty.
 * Returns null only if even trainer ghosts are missing for the subject.
 */
export async function findGhostForMatch(opts: {
  userId: string;
  /** Empty/undefined = match a ghost of ANY subject (the subject-agnostic queue). */
  subject?: string;
  elo: number;
}): Promise<GhostRow | null> {
  const { userId, subject, elo } = opts;
  const now = Date.now();
  const windows = [
    new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
  ];

  // 1. Real (non-trainer) ghosts, tightening recency first then widening.
  for (const since of windows) {
    let q = supabaseAdmin
      .from("duel_ghosts")
      .select(GHOST_COLS)
      .eq("is_trainer", false)
      .neq("owner_user_id", userId)
      .gte("elo_at_recording", elo - ELO_BAND)
      .lte("elo_at_recording", elo + ELO_BAND)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })
      .limit(20);
    if (subject) q = q.eq("subject", subject);
    const { data } = await q;
    if (data && data.length > 0) return normalizeGhost(nearestByElo(data, elo));
  }

  // 2. Trainer fallback — nearest ELO (in the subject if one was given).
  let tq = supabaseAdmin
    .from("duel_ghosts")
    .select(GHOST_COLS)
    .eq("is_trainer", true)
    .order("elo_at_recording", { ascending: true })
    .limit(50);
  if (subject) tq = tq.eq("subject", subject);
  const { data: trainers } = await tq;
  if (trainers && trainers.length > 0) return normalizeGhost(nearestByElo(trainers, elo));

  return null;
}
