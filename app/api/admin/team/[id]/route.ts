// GET /api/admin/team/[id] — one team member, plus a derived MFA status.
// ADMIN ONLY.
//
// Returns the full team_members row (no secrets live on these rows) enriched
// with `mfa: { enrolled }`, which reflects whether the linked auth account has
// at least one VERIFIED TOTP factor. This is a read-only IAM posture signal so
// the console can flag team members who have not enabled multi-factor auth.
//
// The MFA lookup is wrapped in its own try/catch: an auth-API hiccup must
// degrade to mfa: { enrolled: false, unknown: true } rather than failing the
// whole request. A member with no linked auth account (user_id null) reports
// enrolled: false (there is no account to carry a factor).
//
// Secrets are never logged or returned. The factor list is only inspected for
// type + verification status; no factor ids or friendly names are surfaced.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, isUuid } from "@/lib/admin-auth";
import type { TeamMember } from "@/lib/team/types";

type RouteCtx = { params: { id: string } };

interface MfaStatus {
  /** True when the linked auth account has >= 1 verified TOTP factor. */
  enrolled: boolean;
  /** Present + true only when the MFA lookup failed; `enrolled` is then a
   *  fail-closed default, not a confirmed reading. */
  unknown?: boolean;
}

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid team member id" }, { status: 400 });
  }

  const { data: member, error } = await supabaseAdmin
    .from("team_members")
    .select("*")
    .eq("id", id)
    .maybeSingle<TeamMember>();

  if (error) {
    console.error("[admin/team/detail]", error.message);
    return NextResponse.json({ error: "Failed to load team member" }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  // Derive MFA enrollment from the linked auth account. No linked account ->
  // there is nothing to be enrolled, so enrolled stays false (not unknown).
  let mfa: MfaStatus = { enrolled: false };
  if (member.user_id) {
    try {
      const { data: factorData, error: mfaError } =
        await supabaseAdmin.auth.admin.mfa.listFactors({ userId: member.user_id });
      if (mfaError) {
        // Log the failure mode (never the factors themselves) and degrade.
        console.error("[admin/team/detail] mfa lookup failed:", mfaError.message);
        mfa = { enrolled: false, unknown: true };
      } else {
        const hasVerifiedTotp = (factorData?.factors ?? []).some(
          (f) => f.factor_type === "totp" && f.status === "verified",
        );
        mfa = { enrolled: hasVerifiedTotp };
      }
    } catch (err) {
      // An unexpected throw from the auth API must not 500 the whole request.
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error("[admin/team/detail] mfa lookup threw:", msg);
      mfa = { enrolled: false, unknown: true };
    }
  }

  return NextResponse.json({ member: { ...member, mfa } });
}
