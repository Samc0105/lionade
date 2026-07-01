import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { claimReferral, normalizeCode } from "@/lib/referral";

export const dynamic = "force-dynamic";

// A referral can only be attached to a genuinely NEW account. We gate on the
// referee's XP: the signup trigger seeds xp=0, and the first qualifying quiz is
// the first thing that moves it. Requiring xp === 0 blocks an established
// account from retroactively attaching someone's code to farm the reward
// (multi-account abuse: even a spun-up burner has to actually be fresh, and the
// reward still only pays on that burner's FIRST quiz, so farming yields the
// same one-time payout an honest new user gets).
const MAX_XP_TO_CLAIM = 0;
// xp==0 alone is porous: an OLD, inactive account can sit at xp==0 and then
// attach a code to farm the payout. Also require the account be genuinely new.
const ACCOUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /api/referral/claim  { code: string }
 *
 * Attaches a pending referral for the authenticated (new) user. The code is
 * taken from the BODY but the referee id is always the authenticated user —
 * never trusted from the body. Idempotent + abuse-resistant:
 *   - self-referral rejected (referrer === referee)
 *   - a user can be referred once, ever (UNIQUE(referee_id))
 *   - only fresh accounts (xp === 0) may claim
 * Fails soft: no-ops (200, claimed:false) if the migration isn't applied.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const rawCode = (body as { code?: unknown })?.code;
  const code = normalizeCode(typeof rawCode === "string" ? rawCode : "");
  if (!code) {
    return NextResponse.json({ claimed: false, reason: "no-code" });
  }

  // Freshness gate — only brand-new accounts may attach a referral.
  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("xp, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (profErr) {
    console.error("[referral/claim] profile:", profErr.message);
    // Don't hard-fail; treat as not-claimable so we never block the user.
    return NextResponse.json({ claimed: false, reason: "already-active" });
  }

  const xp = (profile as { xp?: number } | null)?.xp ?? 0;
  const createdAt = (profile as { created_at?: string } | null)?.created_at;
  // Fresh = xp still 0 AND created within the age window. If created_at is
  // somehow absent, fall back to the xp gate rather than block a real newcomer.
  const ageOk = !createdAt || Date.now() - new Date(createdAt).getTime() <= ACCOUNT_MAX_AGE_MS;
  if (xp > MAX_XP_TO_CLAIM || !ageOk) {
    return NextResponse.json({ claimed: false, reason: "already-active" });
  }

  const result = await claimReferral(userId, code);
  return NextResponse.json(result);
}
