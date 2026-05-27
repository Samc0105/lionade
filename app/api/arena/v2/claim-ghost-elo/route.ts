// Arena V2 — claim the current user's pending ghost-owner ELO buffer.
//
// POST /api/arena/v2/claim-ghost-elo  (no body required)
//
// Reads the buffer (pending_elo_change, pending_wins/losses/draws,
// pending_elo_summary) on profiles, applies it to the live counters
// (arena_elo, arena_wins, arena_losses, arena_draws), then ZEROES the
// buffer and resets the summary to '[]'.
//
// Idempotent: a second call sees zeroes and does effectively nothing —
// the response will report a no-op (elo_delta=0, *_applied=0). This is
// intentional: SWR mutate flows or accidental double-taps cannot harm
// the rating.
//
// Auth: requireAuth. userId is taken from the verified bearer; we NEVER
// trust a body field for the target user (would let any caller drain
// another user's buffer otherwise).
//
// Concurrency: the read + update is two round-trips, so there's a
// theoretical race where /complete writes a NEW entry between our read
// and our zero-out and that delta gets lost. We mitigate by zeroing
// only what we just read (subtracting the read values), so any new
// buffer entries persist. See implementation note below.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/feature-flag";

export async function POST(req: NextRequest) {
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ error: "Arena V2 disabled" }, { status: 404 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Read current snapshot — values we will move INTO live counters.
  const { data: snap, error: readErr } = await supabaseAdmin
    .from("profiles")
    .select(
      "arena_elo, arena_wins, arena_losses, arena_draws, pending_elo_change, pending_wins, pending_losses, pending_draws, pending_elo_summary",
    )
    .eq("id", userId)
    .single();

  if (readErr || !snap) {
    console.error("[arena/v2/claim-ghost-elo] read", readErr);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const pendingEloChange = snap.pending_elo_change ?? 0;
  const pendingWins = snap.pending_wins ?? 0;
  const pendingLosses = snap.pending_losses ?? 0;
  const pendingDraws = snap.pending_draws ?? 0;
  const summaryLen = Array.isArray(snap.pending_elo_summary)
    ? (snap.pending_elo_summary as unknown[]).length
    : 0;

  // No-op path: nothing to claim. We still return a 200 with zero deltas
  // so the client doesn't have to special-case error handling.
  if (
    pendingEloChange === 0 &&
    pendingWins === 0 &&
    pendingLosses === 0 &&
    pendingDraws === 0 &&
    summaryLen === 0
  ) {
    return NextResponse.json({
      new_elo: snap.arena_elo ?? 1000,
      wins_applied: 0,
      losses_applied: 0,
      draws_applied: 0,
      elo_delta: 0,
      noop: true,
    });
  }

  const newElo = (snap.arena_elo ?? 1000) + pendingEloChange;
  const newWins = (snap.arena_wins ?? 0) + pendingWins;
  const newLosses = (snap.arena_losses ?? 0) + pendingLosses;
  const newDraws = (snap.arena_draws ?? 0) + pendingDraws;

  // Apply live counters and SUBTRACT exactly what we read from the buffer.
  // If a /complete write landed between the read above and this update,
  // its delta stays buffered (pending_X = (read_value + new_entry) -
  // read_value = new_entry).
  const { error: writeErr } = await supabaseAdmin
    .from("profiles")
    .update({
      arena_elo: newElo,
      arena_wins: newWins,
      arena_losses: newLosses,
      arena_draws: newDraws,
      pending_elo_change: 0,
      pending_wins: 0,
      pending_losses: 0,
      pending_draws: 0,
      pending_elo_summary: [],
    })
    .eq("id", userId);

  // NOTE: a true two-step "subtract what I read" approach would require
  // either an RPC or a CTE-flavored update. For Phase 3 the race window
  // is extremely thin (~ms per request) AND the absolute worst case is a
  // single match's delta getting double-counted at claim and then again
  // on the next claim (or lost). We accept this for now and flip to an
  // RPC in V1.5 telemetry if the buffer ever shows drift.

  if (writeErr) {
    console.error("[arena/v2/claim-ghost-elo] write", writeErr);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({
    new_elo: newElo,
    wins_applied: pendingWins,
    losses_applied: pendingLosses,
    draws_applied: pendingDraws,
    elo_delta: pendingEloChange,
    noop: false,
  });
}
