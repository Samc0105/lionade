// Shared competitive tiered daily Fang loss cap.
//
// Originally written for Arena V2 (killed 2026-05-28). This is the LIVE shared
// daily-loss-cap for the competitive 4-mode system, imported by
// app/api/competitive/match/[id]/complete/route.ts. Moved from lib/arena-v2/
// to lib/competitive/ during the V2 deletion so it sits with the code that
// uses it.
//
// From the locked spec (project_arena_v2_decisions.md):
//   ELO < 1200       → -150 Fangs/day
//   ELO 1200–1499    → -300 Fangs/day
//   ELO 1500+        → -500 Fangs/day
//   Pro tier         → -1000 Fangs/day (headroom, still capped)
//
// Plus the 3-loss streak intervention: after 3 consecutive losses in the
// last 24h, dispense a one-time-per-24h +25 Fang "shake it off" gift and
// surface a flag so the UI can show the intervention card.
//
// Tracking source of truth: arena_matches.completed_at + winner_id
// scoped to the user's player1/player2 slot. We could denormalize into a
// daily-counter table later if this query gets hot, but for Phase 1
// reading from arena_matches is fine — DAU is small and the query is
// indexed.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface LossCapTier {
  /** Negative Fang cap per UTC day. */
  capFangs: number;
  /** Label for UI / logging. */
  label: "Bronze" | "Silver" | "Gold" | "Pro";
}

export function resolveLossCapTier(args: {
  elo: number;
  isPro: boolean;
}): LossCapTier {
  if (args.isPro) return { capFangs: -1000, label: "Pro" };
  if (args.elo < 1200) return { capFangs: -150, label: "Bronze" };
  if (args.elo < 1500) return { capFangs: -300, label: "Silver" };
  return { capFangs: -500, label: "Gold" };
}

export interface LossWindowSummary {
  /** Net Fang delta from completed matches in the last UTC day. Negative when net loss. */
  netFangsLast24h: number;
  /** Consecutive losses ending at "now" (within the last 24h). */
  currentLossStreak: number;
  /** Last-seen "shake it off" gift dispense timestamp, ISO. Null if never. */
  lastShakeItOffAt: string | null;
}

/**
 * Computes 24h loss-window stats for a user.
 *
 * Reads BOTH arena_matches (legacy 1v1 Arena) AND competitive_matches (the 5
 * new competitive modes) so the daily loss cap is a SINGLE shared budget across
 * all wager-bearing competitive play (locked, project_competitive_modes.md).
 *
 * For arena_matches the "Fang delta" is wager-signed: winner +wager, loser
 * -wager, draws net 0. Trainer-Ninny matches are excluded (free practice).
 *
 * For competitive_matches the signed per-user delta is already stored on the
 * row's `fang_delta` jsonb (keyed by user_id) at completion time, so we just
 * read it directly. The loss STREAK (for the shake-it-off intervention) is
 * still driven by arena_matches only — the streak intervention is an Arena
 * mechanic and the competitive modes feed only the net-Fang cap, not the
 * streak counter.
 */
export async function computeLossWindow(
  supabase: SupabaseClient,
  userId: string,
): Promise<LossWindowSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: matches } = await supabase
    .from("arena_matches")
    .select("player1_id, player2_id, winner_id, wager, is_trainer_match, completed_at")
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .eq("status", "completed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false });

  let net = 0;
  let streak = 0;
  let streakBroken = false;

  for (const m of matches ?? []) {
    if (m.is_trainer_match) continue;
    const isWin = m.winner_id === userId;
    const isDraw = m.winner_id === null;
    if (isDraw) {
      // draws break streak but don't move Fangs
      streakBroken = true;
      continue;
    }
    net += isWin ? m.wager : -m.wager;
    if (!streakBroken) {
      if (isWin) streakBroken = true;
      else streak += 1;
    }
  }

  // ── Competitive modes contribution to the shared 24h Fang net ──
  // The competitive matcher stores the signed per-user delta on the row's
  // fang_delta jsonb at completion. We sum whichever entry belongs to this
  // user. A user can appear in team_a OR team_b; we query both via the gin
  // indexes (overlaps `&&`). Read-only; never fails the cap if the table is
  // empty or the query errors.
  try {
    const { data: comp } = await supabase
      .from("competitive_matches")
      .select("fang_delta, team_a, team_b, completed_at")
      .eq("status", "completed")
      .gte("completed_at", since)
      .or(`team_a.cs.{${userId}},team_b.cs.{${userId}}`);

    for (const cm of comp ?? []) {
      const delta = (cm.fang_delta ?? {})[userId];
      if (typeof delta === "number") net += delta;
    }
  } catch {
    // Competitive table missing or query hiccup — fall back to arena-only net.
  }

  // Last shake-it-off gift: stored on profiles.last_shake_it_off_at (added
  // via migration 049 implicitly? No — we'll add lazily via a simple read
  // of an existing nudge log or fall back to null). Phase 1 returns null
  // and the complete-endpoint always dispenses on a fresh 3-streak. We'll
  // wire dedup on first re-trigger.
  return {
    netFangsLast24h: net,
    currentLossStreak: streak,
    lastShakeItOffAt: null,
  };
}

/** Has the user hit the daily loss cap? */
export function isLossCapReached(args: {
  netFangsLast24h: number;
  tier: LossCapTier;
}): boolean {
  // netFangs is negative when user is net-down. Tier cap is also negative.
  // Reached when netFangs <= cap (e.g. -300 <= -300).
  return args.netFangsLast24h <= args.tier.capFangs;
}
