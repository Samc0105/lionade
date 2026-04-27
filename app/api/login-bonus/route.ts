import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Daily login bonus — escalating Fang reward gated by a 24h ROLLING
 * cooldown (not a calendar day). The user can claim once every 24 hours
 * counted from their most recent claim.
 *
 * Tier escalation:
 *   Tier 0 = 10F (first claim, or after a >48h gap)
 *   Tier 1 = 15F (claimed within the previous 48h)
 *   Tier 2 = 25F (the claim before the previous one was also <48h ago)
 *
 * The 48h grace window between consecutive claims is intentional — a user
 * who claims at 8am Monday and again at 11am Tuesday should still tier up,
 * even though the gap is 27h (over 24).
 *
 *   POST /api/login-bonus → claim
 *   GET  /api/login-bonus → status (cooldown countdown, lifetime stats)
 */

const BONUS_TIERS = [10, 15, 25];
const COOLDOWN_MS = 24 * 60 * 60 * 1000;   // hard 24h between claims
const STREAK_WINDOW_MS = 48 * 60 * 60 * 1000; // looser window for tiering

interface BonusRow {
  amount: number;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────
async function loadHistory(userId: string): Promise<BonusRow[]> {
  const { data } = await supabaseAdmin
    .from("coin_transactions")
    .select("amount, created_at")
    .eq("user_id", userId)
    .eq("type", "login_bonus")
    .order("created_at", { ascending: false })
    .limit(60);
  return (data ?? []) as BonusRow[];
}

function computeStreak(history: BonusRow[]): number {
  // Walk back through history. A claim is "in streak" if the gap to the
  // NEXT older claim is <= STREAK_WINDOW_MS.
  if (history.length === 0) return 0;
  let streak = 1;
  for (let i = 0; i < history.length - 1; i++) {
    const gap = new Date(history[i].created_at).getTime() - new Date(history[i + 1].created_at).getTime();
    if (gap <= STREAK_WINDOW_MS) streak++;
    else break;
  }
  return streak;
}

function tierForStreak(streakIncludingNew: number): number {
  return Math.min(streakIncludingNew - 1, BONUS_TIERS.length - 1);
}

function lifetimeFangs(history: BonusRow[]): number {
  return history.reduce((s, r) => s + (r.amount ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — status snapshot for the navbar button + history popover.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const history = await loadHistory(userId);
  const lastClaim = history[0] ?? null;
  const lastClaimAt = lastClaim ? new Date(lastClaim.created_at).getTime() : null;
  const nextAvailableAt = lastClaimAt ? lastClaimAt + COOLDOWN_MS : Date.now();
  const msUntilAvailable = Math.max(0, nextAvailableAt - Date.now());
  const available = msUntilAvailable === 0;

  const currentStreak = computeStreak(history);
  // The next claim, if available, would extend the streak only when the
  // last claim was within STREAK_WINDOW_MS — otherwise it resets to 1.
  const wouldExtendStreak = lastClaimAt !== null
    && (Date.now() - lastClaimAt) <= STREAK_WINDOW_MS;
  const nextStreak = wouldExtendStreak ? currentStreak + 1 : 1;
  const nextAmount = BONUS_TIERS[tierForStreak(nextStreak)];

  return NextResponse.json({
    available,
    nextAvailableAt: new Date(nextAvailableAt).toISOString(),
    msUntilAvailable,
    cooldownMs: COOLDOWN_MS,
    lastClaimAt: lastClaimAt ? new Date(lastClaimAt).toISOString() : null,
    lastAmount: lastClaim?.amount ?? null,
    currentStreak,
    nextStreak,
    nextAmount,
    lifetimeFangs: lifetimeFangs(history),
    totalClaims: history.length,
    recent: history.slice(0, 7).map(h => ({
      amount: h.amount,
      claimedAt: h.created_at,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — claim. Idempotent within the cooldown window.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const history = await loadHistory(userId);
  const lastClaim = history[0] ?? null;

  if (lastClaim) {
    const sinceLast = Date.now() - new Date(lastClaim.created_at).getTime();
    if (sinceLast < COOLDOWN_MS) {
      const remaining = COOLDOWN_MS - sinceLast;
      return NextResponse.json({
        awarded: false,
        reason: "on_cooldown",
        msUntilAvailable: remaining,
        nextAvailableAt: new Date(Date.now() + remaining).toISOString(),
      });
    }
  }

  // Tier from the streak that this new claim would create.
  const wouldExtend = lastClaim
    && (Date.now() - new Date(lastClaim.created_at).getTime()) <= STREAK_WINDOW_MS;
  const newStreak = wouldExtend ? computeStreak(history) + 1 : 1;
  const amount = BONUS_TIERS[tierForStreak(newStreak)];

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { error: profErr } = await supabaseAdmin
    .from("profiles")
    .update({ coins: (profile.coins ?? 0) + amount })
    .eq("id", userId);
  if (profErr) {
    console.error("[login-bonus POST] coin add:", profErr.message);
    return NextResponse.json({ error: "Couldn't credit Fangs." }, { status: 500 });
  }

  const { error: txErr } = await supabaseAdmin.from("coin_transactions").insert({
    user_id: userId,
    amount,
    type: "login_bonus",
    description: `Day ${newStreak} login bonus`,
  });
  if (txErr) {
    // Roll back the coin add to keep audit + balance in sync.
    await supabaseAdmin
      .from("profiles")
      .update({ coins: profile.coins ?? 0 })
      .eq("id", userId);
    console.error("[login-bonus POST] tx insert:", txErr.message);
    return NextResponse.json({ error: "Couldn't log claim." }, { status: 500 });
  }

  return NextResponse.json({
    awarded: true,
    amount,
    consecutiveDays: newStreak,
    nextAvailableAt: new Date(Date.now() + COOLDOWN_MS).toISOString(),
    lifetimeFangs: lifetimeFangs(history) + amount,
  });
}
