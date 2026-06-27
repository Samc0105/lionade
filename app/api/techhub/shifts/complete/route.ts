import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";

// ── Server-owned reward ceilings ───────────────────────────────────────────
// The client NEVER decides the grant. It reports a score; the server clamps the
// Fang reward to this ceiling per shift and grants it at most once (first
// qualifying clear). Mirrors the save-quiz-results philosophy: derive/clamp the
// reward server-side so a crafted client cannot self-grant. Keep these in sync
// with the shift definitions in lib/liondesk/*.
const SHIFT_REWARDS: Record<string, { maxFangs: number }> = {
  "helpdesk-shift-1": { maxFangs: 220 },
  "helpdesk-shift-2": { maxFangs: 260 },
  "helpdesk-shift-3": { maxFangs: 280 },
  "helpdesk-shift-4": { maxFangs: 280 },
  "helpdesk-shift-5": { maxFangs: 320 },
  "soc-shift-1": { maxFangs: 240 },
  "soc-shift-2": { maxFangs: 300 },
  "soc-shift-3": { maxFangs: 320 },
  "soc-shift-4": { maxFangs: 340 },
  "soc-shift-5": { maxFangs: 380 },
  "swe-shift-1": { maxFangs: 240 },
  "swe-shift-2": { maxFangs: 300 },
  "swe-shift-3": { maxFangs: 320 },
  "swe-shift-4": { maxFangs: 340 },
  "swe-shift-5": { maxFangs: 380 },
  "redteam-shift-1": { maxFangs: 240 },
  "redteam-shift-2": { maxFangs: 300 },
  "redteam-shift-3": { maxFangs: 320 },
  "redteam-shift-4": { maxFangs: 340 },
  "redteam-shift-5": { maxFangs: 380 },
};

const PASS_SCORE = 50;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = (await req.json().catch(() => null)) as { shiftId?: string; score?: number; csat?: number } | null;
  const shiftId = String(body?.shiftId ?? "");
  const score = Math.max(0, Math.min(100, Math.round(Number(body?.score ?? 0))));
  const csat = Math.max(0, Math.min(100, Math.round(Number(body?.csat ?? 0))));

  const cap = SHIFT_REWARDS[shiftId];
  if (!cap) return NextResponse.json({ error: "Unknown shift." }, { status: 400 });

  // Reward scales with score and is capped server-side. A failed shift earns nothing.
  const earnedFangs = score >= PASS_SCORE ? Math.round(cap.maxFangs * (score / 100)) : 0;

  // Load any prior completion to keep the best score + guard the one-time grant.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("techhub_shift_completions")
    .select("best_score, plays, fangs_granted")
    .eq("user_id", userId)
    .eq("shift_id", shiftId)
    .maybeSingle();

  // Migration not applied yet (table missing): keep the client working on its
  // local progress instead of erroring. This route activates once the held
  // migration 20260626120000 is live.
  if (readErr && (readErr.code === "42P01" || /relation .* does not exist/i.test(readErr.message))) {
    return NextResponse.json({ ok: false, pending: true });
  }

  const bestScore = Math.max(score, existing?.best_score ?? 0);
  const alreadyGranted = existing?.fangs_granted ?? false;
  const shouldGrant = !alreadyGranted && earnedFangs > 0;

  const { error: upsertErr } = await supabaseAdmin
    .from("techhub_shift_completions")
    .upsert(
      {
        user_id: userId,
        shift_id: shiftId,
        best_score: bestScore,
        last_csat: csat,
        plays: (existing?.plays ?? 0) + 1,
        fangs_granted: alreadyGranted || shouldGrant,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,shift_id" },
    );
  if (upsertErr) {
    return NextResponse.json({ error: "Couldn't save completion." }, { status: 500 });
  }

  if (shouldGrant) {
    // Atomic, server-authoritative Fang credit (same RPC as quiz rewards).
    const { error: coinErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: earnedFangs,
      p_min_balance: 0,
      p_source: "cashable",
    });
    if (coinErr) {
      // Roll the grant flag back so a transient failure can be retried, not lost.
      await supabaseAdmin
        .from("techhub_shift_completions")
        .update({ fangs_granted: false })
        .eq("user_id", userId)
        .eq("shift_id", shiftId);
      return NextResponse.json({ error: "Grant failed." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, bestScore, granted: shouldGrant ? earnedFangs : 0 });
}
