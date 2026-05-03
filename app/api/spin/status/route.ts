import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { canSpinNow, nextSpinAt, SPIN_COOLDOWN_MS } from "@/lib/spin";

export const dynamic = "force-dynamic";

/**
 * GET /api/spin/status
 *
 * Returns whether the user can spin right now and, if not, when their next
 * spin unlocks. Used by the shop hero card to render the live countdown.
 *
 * Always 200 even on internal errors — the spin button shouldn't disappear
 * just because we couldn't read the audit log; we fail OPEN (allow spin)
 * because the roll endpoint will re-check the cooldown atomically anyway.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("daily_spins")
    .select("spun_at, outcome, fangs_delta")
    .eq("user_id", userId)
    .order("spun_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[spin/status] read error:", error.message);
    return NextResponse.json({
      canSpin: true,
      lastSpinAt: null,
      nextSpinAt: null,
      cooldownMs: SPIN_COOLDOWN_MS,
      lastOutcome: null,
    });
  }

  const lastSpunAt = data?.spun_at ? new Date(data.spun_at) : null;
  const next = nextSpinAt(lastSpunAt);

  return NextResponse.json({
    canSpin: canSpinNow(lastSpunAt),
    lastSpinAt: lastSpunAt?.toISOString() ?? null,
    nextSpinAt: next?.toISOString() ?? null,
    cooldownMs: SPIN_COOLDOWN_MS,
    lastOutcome: data
      ? { outcome: data.outcome, fangsDelta: data.fangs_delta }
      : null,
  });
}
