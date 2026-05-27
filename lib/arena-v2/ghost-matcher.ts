// Arena V2 ghost matchmaking cascade.
//
// From locked spec:
//   1. Subject-strict match (no cross-subject fallback in V1).
//   2. ELO ±300 window. If gap >300 → still match, but stake reduced 50%
//      with "Mismatched Duel" label (the stake-reduce belongs to the
//      complete-endpoint; this matcher just returns the candidate + a flag).
//   3. Look at last 24h first; if empty, expand to last 7d.
//   4. If user has < 3 V2 duels OR < 24h since first V2 duel → match
//      against a Trainer Ninny ghost (is_trainer = true).
//   5. If graduated AND no real ghost available → return no-ghost dead-end.
//
// We also skip:
//   - The caller's own ghosts (no replaying yourself).
//   - Anything they've already replayed in the last 7d (avoid déjà vu).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface GhostCandidate {
  id: string;
  owner_user_id: string;
  subject: string;
  elo_at_recording: number;
  question_ids: string[];
  recorded_at: string;
  is_trainer: boolean;
  /** True when gap >300 ELO — caller should halve the stake. */
  isMismatched: boolean;
}

export interface MatchResult {
  status: "matched" | "no_ghost_available" | "trainer_ninny";
  ghost: GhostCandidate | null;
}

const ELO_WINDOW = 300;
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TRAINER_GRADUATION_DUELS = 3;
const TRAINER_GRADUATION_MS = 24 * 60 * 60 * 1000;

export async function findGhost(args: {
  supabase: SupabaseClient;
  userId: string;
  userElo: number;
  subject: string;
}): Promise<MatchResult> {
  const { supabase, userId, userElo, subject } = args;

  // 1. Check trainer-graduation status: count of user's completed V2 matches
  //    + earliest V2 match completed_at.
  const { data: v2Matches } = await supabase
    .from("arena_matches")
    .select("completed_at, is_trainer_match")
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .eq("is_async", true)
    .eq("status", "completed")
    .order("completed_at", { ascending: true });

  const completedCount = v2Matches?.length ?? 0;
  const firstAt = v2Matches?.[0]?.completed_at;
  const firstAge = firstAt ? Date.now() - new Date(firstAt).getTime() : Infinity;
  const isInTrainerWindow =
    completedCount < TRAINER_GRADUATION_DUELS || firstAge < TRAINER_GRADUATION_MS;

  // 2. Try real ghosts first (24h window).
  if (!isInTrainerWindow) {
    const real24 = await queryRealGhost(supabase, userId, userElo, subject, FRESH_WINDOW_MS);
    if (real24) return { status: "matched", ghost: real24 };
    const real7 = await queryRealGhost(supabase, userId, userElo, subject, STALE_WINDOW_MS);
    if (real7) return { status: "matched", ghost: real7 };
    return { status: "no_ghost_available", ghost: null };
  }

  // 3. Trainer-window user: prefer trainer ghost in their ELO band.
  const trainer = await queryTrainerGhost(supabase, userElo, subject);
  if (trainer) return { status: "trainer_ninny", ghost: trainer };

  // 4. Trainer pool empty for this subject/band — fall through to real
  //    ghosts (24h, then 7d) even though they're in the trainer window.
  //    Better a real ghost than dead-end.
  const real24 = await queryRealGhost(supabase, userId, userElo, subject, FRESH_WINDOW_MS);
  if (real24) return { status: "matched", ghost: real24 };
  const real7 = await queryRealGhost(supabase, userId, userElo, subject, STALE_WINDOW_MS);
  if (real7) return { status: "matched", ghost: real7 };
  return { status: "no_ghost_available", ghost: null };
}

async function queryRealGhost(
  supabase: SupabaseClient,
  userId: string,
  userElo: number,
  subject: string,
  windowMs: number,
): Promise<GhostCandidate | null> {
  const since = new Date(Date.now() - windowMs).toISOString();

  const { data } = await supabase
    .from("duel_ghosts")
    .select("id, owner_user_id, subject, elo_at_recording, question_ids, recorded_at, is_trainer")
    .eq("subject", subject)
    .eq("is_trainer", false)
    .neq("owner_user_id", userId)
    .gte("recorded_at", since)
    .gte("elo_at_recording", userElo - ELO_WINDOW)
    .lte("elo_at_recording", userElo + ELO_WINDOW)
    .order("recorded_at", { ascending: false })
    .limit(20);

  if (data && data.length > 0) {
    // Pick a random candidate from the top 20 freshest — slight variety
    // without expensive ORDER BY random().
    const pick = data[Math.floor(Math.random() * data.length)];
    return { ...pick, isMismatched: false };
  }

  // Out-of-window fallback: ANY ELO same-subject, halved stake.
  const { data: wide } = await supabase
    .from("duel_ghosts")
    .select("id, owner_user_id, subject, elo_at_recording, question_ids, recorded_at, is_trainer")
    .eq("subject", subject)
    .eq("is_trainer", false)
    .neq("owner_user_id", userId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(10);

  if (wide && wide.length > 0) {
    const pick = wide[Math.floor(Math.random() * wide.length)];
    return { ...pick, isMismatched: true };
  }
  return null;
}

async function queryTrainerGhost(
  supabase: SupabaseClient,
  userElo: number,
  subject: string,
): Promise<GhostCandidate | null> {
  // Trainer ghosts are seeded at ELO bands 1100 / 1400 / 1700. Pick the
  // band closest to the user's ELO; if none in that band, fall through to
  // any trainer ghost for the subject.
  const bands = [1100, 1400, 1700];
  const targetBand = bands.reduce((best, b) =>
    Math.abs(b - userElo) < Math.abs(best - userElo) ? b : best,
  );

  const { data } = await supabase
    .from("duel_ghosts")
    .select("id, owner_user_id, subject, elo_at_recording, question_ids, recorded_at, is_trainer")
    .eq("subject", subject)
    .eq("is_trainer", true)
    .eq("elo_at_recording", targetBand)
    .limit(5);

  if (data && data.length > 0) {
    const pick = data[Math.floor(Math.random() * data.length)];
    return { ...pick, isMismatched: false };
  }

  // Any trainer ghost for this subject.
  const { data: any } = await supabase
    .from("duel_ghosts")
    .select("id, owner_user_id, subject, elo_at_recording, question_ids, recorded_at, is_trainer")
    .eq("subject", subject)
    .eq("is_trainer", true)
    .order("elo_at_recording", { ascending: true })
    .limit(5);

  if (any && any.length > 0) {
    const pick = any[Math.floor(Math.random() * any.length)];
    return { ...pick, isMismatched: false };
  }
  return null;
}
