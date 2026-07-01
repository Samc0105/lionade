/**
 * POST /api/arena/v2/claim-ghost-elo
 *
 * Applies a ghost owner's BUFFERED offline ELO on login. When someone duels
 * your recorded ghost while you're offline, /api/arena/v2/complete buffers your
 * symmetric ELO delta (+ W/L/D) onto profiles.pending_* instead of writing it
 * live, so the rating pool stays conserved AND you get to SEE the change. This
 * route applies the buffer, returns the summary for the Claim card, and zeroes
 * the buffer in the SAME update.
 *
 * Idempotent by compare-and-swap: the update only lands if the buffer still
 * holds the exact values we read, so a double-tap / concurrent claim applies
 * nothing the second time. Service-role only — the 078/080 guard trigger blocks
 * non-service_role writes to arena_elo / pending_*. ELO + counters only; no
 * Fang / value transfer ever touches a ghost duel.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ claimed: false, disabled: true });
  }
  const userId = auth.userId;

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "arena_elo, arena_wins, arena_losses, arena_draws, pending_elo_change, pending_elo_summary, pending_wins, pending_losses, pending_draws",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile) {
    return NextResponse.json({ error: "Profile lookup failed" }, { status: 500 });
  }

  const pendingElo = profile.pending_elo_change ?? 0;
  const pendingWins = profile.pending_wins ?? 0;
  const pendingLosses = profile.pending_losses ?? 0;
  const pendingDraws = profile.pending_draws ?? 0;
  const summary = profile.pending_elo_summary ?? [];

  if (pendingElo === 0 && pendingWins === 0 && pendingLosses === 0 && pendingDraws === 0) {
    return NextResponse.json({ claimed: false, nothingPending: true });
  }

  const newElo = (profile.arena_elo ?? 1000) + pendingElo;

  // Compare-and-swap on the FULL buffer state we read, so a concurrent claim
  // that already applied+zeroed it matches 0 rows here (no double-apply).
  const { data: applied, error: applyErr } = await supabaseAdmin
    .from("profiles")
    .update({
      arena_elo: newElo,
      arena_wins: (profile.arena_wins ?? 0) + pendingWins,
      arena_losses: (profile.arena_losses ?? 0) + pendingLosses,
      arena_draws: (profile.arena_draws ?? 0) + pendingDraws,
      pending_elo_change: 0,
      pending_elo_summary: [],
      pending_wins: 0,
      pending_losses: 0,
      pending_draws: 0,
    })
    .eq("id", userId)
    .eq("pending_elo_change", pendingElo)
    .eq("pending_wins", pendingWins)
    .eq("pending_losses", pendingLosses)
    .eq("pending_draws", pendingDraws)
    .select("id")
    .maybeSingle();

  if (applyErr) {
    console.error("[arena/v2/claim] apply:", applyErr.message);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  }
  if (!applied) {
    // Someone else already claimed it (buffer no longer matches).
    return NextResponse.json({ claimed: false, alreadyClaimed: true });
  }

  return NextResponse.json({
    claimed: true,
    eloChange: pendingElo,
    newElo,
    wins: pendingWins,
    losses: pendingLosses,
    draws: pendingDraws,
    summary,
  });
}
