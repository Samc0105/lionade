import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { shiftPayout, type Difficulty } from "@/lib/liondesk/engine";

// ── Server-owned reward ceilings ───────────────────────────────────────────
// The client NEVER decides the grant. It reports how a shift went; the server
// derives and clamps the Fang reward per shift and grants it at most once (first
// qualifying clear, plus a top-up on a higher-scoring replay). Each maxFangs
// below is now the HARD-difficulty ceiling: shiftPayout() (the one shared payout
// helper, in lib/liondesk/engine) scales Easy and Normal down by fixed factors,
// adds a small clean-clear bonus when no lifeline was spent and a tiny best-
// streak bonus, and clamps so a shift can never pay above its maxFangs. Mirrors
// the save-quiz-results philosophy (derive and clamp server-side so a crafted
// client cannot self-grant). Keep these in sync with the shift definitions in
// lib/liondesk/*.
const SHIFT_REWARDS: Record<string, { maxFangs: number }> = {
  "helpdesk-shift-1": { maxFangs: 220 },
  "helpdesk-shift-2": { maxFangs: 260 },
  "helpdesk-shift-3": { maxFangs: 280 },
  "helpdesk-shift-4": { maxFangs: 280 },
  "helpdesk-shift-5": { maxFangs: 320 },
  "helpdesk-major-incident": { maxFangs: 360 },
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
  "netops-shift-1": { maxFangs: 240 },
  "netops-shift-2": { maxFangs: 300 },
  // Seasonal / limited time shifts (lib/liondesk/seasonal.ts). Like every other
  // entry these are PREVIEW ONLY until the held migration 20260626120000 is
  // applied: the table is missing, so the route returns { pending: true } and
  // banks nothing. Clearing one also grants a cosmetic badge client side, which
  // never touches Fangs. Never grant Fangs from the client.
  "seasonal-patch-tuesday": { maxFangs: 300 },
  "seasonal-black-friday": { maxFangs: 340 },
  "seasonal-breach-response": { maxFangs: 360 },
};

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = (await req.json().catch(() => null)) as {
    shiftId?: string;
    score?: number;
    csat?: number;
    difficulty?: string;
    usedLifeline?: boolean;
    bestStreak?: number;
  } | null;
  const shiftId = String(body?.shiftId ?? "");
  // Coerce defensively: Number("x") is NaN, which survives Math.round/min/max and
  // would violate the NOT NULL int columns. A non-finite value is treated as 0.
  const toScore = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; };
  const score = toScore(body?.score);
  const csat = toScore(body?.csat);
  // Difficulty-weighting inputs for the payout. These shape the (still clamped)
  // amount; they can never lift it above the shift's maxFangs ceiling. Defaults
  // are conservative so missing or crafted fields never overpay: HARD (full
  // ceiling, no scale-down), lifeline assumed spent (no clean-clear bonus), and
  // a zero streak. With those defaults shiftPayout reduces to the prior flat
  // round(maxFangs * score/100), so this stays backward compatible until the
  // client reports how a shift was played.
  const rawDifficulty = body?.difficulty;
  const difficulty: Difficulty = rawDifficulty === "easy" || rawDifficulty === "normal" ? rawDifficulty : "hard";
  const usedLifeline = body?.usedLifeline !== false;
  const rawStreak = Number(body?.bestStreak);
  const bestStreak = Number.isFinite(rawStreak) ? Math.max(0, Math.round(rawStreak)) : 0;

  const cap = SHIFT_REWARDS[shiftId];
  if (!cap) return NextResponse.json({ error: "Unknown shift." }, { status: 400 });

  // Load any prior completion to keep the best score + the running grant total.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("techhub_shift_completions")
    .select("best_score, plays, granted_fangs")
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
  const alreadyGranted = existing?.granted_fangs ?? 0;
  // The reward is owed against the player's BEST score, difficulty-weighted and
  // clamped server-side to the shift's maxFangs ceiling (shiftPayout handles the
  // PASS_SCORE clear gate and the ceiling clamp). We pay only the positive
  // difference vs. what was already granted: full amount on a first qualifying
  // clear, the top-up on a higher-scoring replay, and nothing on a same/lower
  // replay. max(0, ...) keeps the ledger monotonic, so a lower-weighted replay
  // (e.g. a later Easy run) never claws back. Idempotent on the amount.
  const owedForBest = shiftPayout(cap.maxFangs, bestScore, difficulty, usedLifeline, bestStreak);
  const delta = Math.max(0, owedForBest - alreadyGranted);
  const newGrantedTotal = alreadyGranted + delta;
  const completedAt = new Date().toISOString();

  // Persist the completion under OPTIMISTIC CONCURRENCY so two simultaneous
  // submits of the same shift can never both credit `delta` (a double-pay). Only
  // the write that actually advances granted_fangs from the value we read earns
  // the right to credit; a racing loser sees 0 rows affected and credits nothing.
  let committed = false;
  if (!existing) {
    // First completion for this shift: insert. A concurrent first insert loses on
    // the unique (user_id, shift_id) constraint (23505); that loser does not
    // credit (the winner already did). A higher score it missed self-heals on the
    // player's next replay, since the grant is idempotent on best score.
    const { error: insErr } = await supabaseAdmin
      .from("techhub_shift_completions")
      .insert({ user_id: userId, shift_id: shiftId, best_score: bestScore, last_csat: csat, plays: 1, granted_fangs: newGrantedTotal, completed_at: completedAt });
    if (insErr) {
      if (insErr.code === "23505") return NextResponse.json({ ok: true, bestScore, granted: 0 });
      return NextResponse.json({ error: "Couldn't save completion." }, { status: 500 });
    }
    committed = true;
  } else {
    // Existing row: a conditional UPDATE gated on the granted_fangs we read. If a
    // concurrent request already advanced it, our WHERE matches 0 rows and we do
    // not credit. .select() returns the rows we actually changed.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("techhub_shift_completions")
      .update({ best_score: bestScore, last_csat: csat, plays: (existing.plays ?? 0) + 1, granted_fangs: newGrantedTotal, completed_at: completedAt })
      .eq("user_id", userId)
      .eq("shift_id", shiftId)
      .eq("granted_fangs", alreadyGranted)
      .select("id");
    if (updErr) return NextResponse.json({ error: "Couldn't save completion." }, { status: 500 });
    committed = (updated?.length ?? 0) === 1;
  }

  if (committed && delta > 0) {
    // Server-authoritative Fang credit (same RPC as quiz rewards). We advanced
    // granted_fangs above and credit exactly once; on failure we roll the total
    // back to alreadyGranted (guarded so we only undo our own advance) so the
    // next submit retries, and log if even the rollback fails.
    const { error: coinErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: delta,
      p_min_balance: 0,
      p_source: "cashable",
    });
    if (coinErr) {
      const { error: rbErr } = await supabaseAdmin
        .from("techhub_shift_completions")
        .update({ granted_fangs: alreadyGranted })
        .eq("user_id", userId)
        .eq("shift_id", shiftId)
        .eq("granted_fangs", newGrantedTotal);
      if (rbErr) console.error("techhub grant rollback failed", { userId, shiftId, rbErr });
      return NextResponse.json({ error: "Grant failed." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, bestScore, granted: committed ? delta : 0 });
}
