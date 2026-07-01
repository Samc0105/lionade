import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  ensureReferralCode,
  getReferralStats,
  REFERRAL_REWARD_FANGS,
} from "@/lib/referral";

export const dynamic = "force-dynamic";

/**
 * GET /api/referral/me
 *
 * Returns the caller's shareable referral code + outgoing referral counts.
 * Assigns a code on first call. Fails soft: if the referral migration isn't
 * applied yet, returns { enabled:false } and the UI hides the panel.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { enabled, code } = await ensureReferralCode(userId);
  if (!enabled || !code) {
    return NextResponse.json({ enabled: false });
  }

  const stats = await getReferralStats(userId, code);

  return NextResponse.json({
    enabled: true,
    code,
    reward: REFERRAL_REWARD_FANGS,
    pending: stats.pending,
    rewarded: stats.rewarded,
  });
}
