// Arena V2 — read the current user's pending ghost-owner ELO buffer.
//
// GET /api/arena/v2/ghost-elo-summary
//
// Returns the offline-accumulated ELO buffer that was deposited by Phase 3
// /complete writes whenever the user's recorded ghost was challenged while
// they were offline. The UI (components/arena-v2/GhostEloCard.tsx) renders
// a Claim card when `hasPending === true`.
//
// Auth: requireAuth. We deliberately read the userId from the verified
// bearer, never from the body, so a caller can only ever inspect their
// own buffer.
//
// Response shape:
//   {
//     pending: {
//       elo_change: number,           // signed sum, can be negative
//       wins:      number,
//       losses:    number,
//       draws:     number,
//       summary:   GhostSummaryEntry[],  // FIFO-capped at 50 by writer
//       current_elo: number              // user's arena_elo right now (pre-claim)
//     },
//     hasPending: boolean
//   }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/feature-flag";

interface GhostSummaryEntry {
  match_id: string;
  challenged_at: string;
  challenger_anon_handle: string;
  subject: string;
  outcome: "ghost_won" | "ghost_lost" | "draw";
  elo_delta: number;
}

export async function GET(req: NextRequest) {
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ error: "Arena V2 disabled" }, { status: 404 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "arena_elo, pending_elo_change, pending_elo_summary, pending_wins, pending_losses, pending_draws",
    )
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[arena/v2/ghost-elo-summary]", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const eloChange = data?.pending_elo_change ?? 0;
  const summary = (data?.pending_elo_summary ?? []) as GhostSummaryEntry[];
  const wins = data?.pending_wins ?? 0;
  const losses = data?.pending_losses ?? 0;
  const draws = data?.pending_draws ?? 0;
  const currentElo = data?.arena_elo ?? 1000;

  const hasPending = eloChange !== 0 || summary.length > 0;

  return NextResponse.json({
    pending: {
      elo_change: eloChange,
      wins,
      losses,
      draws,
      summary,
      current_elo: currentElo,
    },
    hasPending,
  });
}
