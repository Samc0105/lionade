// GET /api/team/me — the CALLER's own team-membership + MFA status.
//
// This is the only team-membership read a non-admin is allowed to make, and it
// returns ONLY the caller's own data. There is no id in the request and there
// never can be: the subject is always auth.userId resolved from the bearer
// token via getAuthedUser. A regular (non-team) user gets the safe all-false
// shape — never a 403 that would leak "you are/aren't a team member" by status
// code, and never another member's row.
//
// SECURITY INVARIANTS (non-negotiable):
//   - getAuthedUser(req) resolves the subject from the bearer JWT. No body is
//     parsed; no id is ever read from the request.
//   - The team_members lookup is keyed strictly on user_id = caller. A missing
//     row (the common case for normal users) is NOT an error: it means
//     isTeamMember:false with every flag false.
//   - requiresMfa mirrors the enforced-MFA set used by the cron + provision:
//     role in (founder, engineer, support) AND lionade_access <> 'none' AND
//     status = 'active'. mfaEnrolled is a server-side admin read of the caller's
//     own factors (verified TOTP only).
//   - Errors return a generic body. The Supabase error.message is logged
//     server-side only, never echoed.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getAuthedUser } from "@/lib/api-auth";
import type { TeamMember } from "@/lib/team/types";

/** The enforced-MFA role set. Mirrors app/api/cron/team-mfa-enforce. */
const ENFORCED_ROLES: ReadonlySet<TeamMember["role"]> = new Set<TeamMember["role"]>([
  "founder",
  "engineer",
  "support",
]);

/** The safe response shape for a caller who is not a team member. */
const NON_MEMBER = {
  isTeamMember: false as const,
  mustChangePassword: false as const,
  requiresMfa: false as const,
  mfaEnrolled: false as const,
};

export async function GET(req: NextRequest) {
  // 1) Resolve the caller from the bearer token. No body, no id from the wire.
  const auth = await getAuthedUser(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = auth.userId;

  // 2) Look up ONLY the caller's own team_members row. maybeSingle() returns
  //    null (not an error) when there is no row — that is the normal-user path.
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("team_members")
    .select("role, lionade_access, status, must_change_password")
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) {
    // Never echo the Supabase message. On a read fault, fail to the safe
    // non-member shape so the gate degrades open rather than locking everyone.
    console.error("[team/me]", memberErr.message);
    return NextResponse.json(NON_MEMBER);
  }
  if (!member) {
    return NextResponse.json(NON_MEMBER);
  }

  // The project does not generate Database generics, so select() returns a
  // loosely-typed row. Name the columns we depend on (no `any` introduced).
  const row = member as {
    role: TeamMember["role"];
    lionade_access: TeamMember["lionade_access"];
    status: TeamMember["status"];
    must_change_password: boolean | null;
  };

  const mustChangePassword = row.must_change_password === true;

  // 3) requiresMfa: the enforced-MFA set, identical to the cron + provision.
  const requiresMfa =
    ENFORCED_ROLES.has(row.role) &&
    row.lionade_access !== "none" &&
    row.status === "active";

  // 4) mfaEnrolled: a verified TOTP factor on the caller's own account. Only
  //    read when MFA is actually required for them — a non-enforced member
  //    never needs the factor list, and we never read another user's factors.
  let mfaEnrolled = false;
  if (requiresMfa) {
    const { data: mfa, error: mfaErr } =
      await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
    if (mfaErr) {
      // Log only; treat an MFA read fault as "not confirmed enrolled" so the
      // gate can still route the member to enrollment rather than crash.
      console.error("[team/me] mfa read failed:", mfaErr.message);
    } else {
      mfaEnrolled = (mfa?.factors ?? []).some(
        (f) => f.factor_type === "totp" && f.status === "verified",
      );
    }
  }

  return NextResponse.json({
    isTeamMember: true,
    mustChangePassword,
    requiresMfa,
    mfaEnrolled,
  });
}
