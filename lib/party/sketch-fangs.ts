// Server-authoritative Fang minting for Sketchy Subjects.
//
// Every award is recorded in sketch_fang_awards with a UNIQUE(round_id, user_id,
// reason) constraint, so a retry of the /guess or /complete endpoint never
// double-mints. We INSERT the ledger row FIRST; only if that insert actually
// created a row (not a conflict) do we credit profiles.coins. This makes the
// "ledger + balance" pair atomic-enough for a participation faucet: the unique
// constraint is the lock.
//
// Fangs are stored in profiles.coins under the hood and surfaced as "Fangs" in
// the UI (never coins/tokens/points). Mirrors the competitive complete route's
// server-side credit pattern (lib/competitive/fang-payout.ts consumers).

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Idempotently award `fangs` to `userId` for a (round, reason) pair.
 * Returns the number of Fangs actually minted (0 if already awarded or invalid).
 */
export async function awardSketchFangs(
  admin: SupabaseClient,
  args: { roundId: string; userId: string; reason: string; fangs: number },
): Promise<number> {
  const { roundId, userId, reason, fangs } = args;
  if (!fangs || fangs <= 0) return 0;

  // Claim the award slot. ignoreDuplicates so a re-run is a silent no-op.
  const { data: inserted, error: insErr } = await admin
    .from("sketch_fang_awards")
    .upsert(
      { round_id: roundId, user_id: userId, reason, fangs },
      { onConflict: "round_id,user_id,reason", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) {
    console.error("[awardSketchFangs] ledger insert", insErr.message);
    return 0;
  }
  // No row returned => the (round,user,reason) award already existed. Skip mint.
  if (!inserted || inserted.length === 0) return 0;

  // Credit the balance server-side (service role bypasses RLS).
  const { data: prof } = await admin
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .maybeSingle();
  if (!prof) return 0;
  const newCoins = (prof.coins ?? 0) + fangs;
  const { error: updErr } = await admin
    .from("profiles")
    .update({ coins: newCoins })
    .eq("id", userId);
  if (updErr) {
    console.error("[awardSketchFangs] coins update", updErr.message);
    return 0;
  }
  return fangs;
}
