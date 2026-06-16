// GET /api/cron/team-mfa-enforce — Vercel cron entry point.
//
// IAM hardening: every privileged team member (founder / engineer / support
// with non-none Lionade access) must enroll a verified TOTP factor within a
// 7-day grace window of being activated (or invited, if never separately
// activated). This sweep enforces that. After the grace window elapses, any
// such member who still has NO verified TOTP factor is locked out: the auth
// account is banned and the membership flips to 'suspended'.
//
// Why a cron rather than a sign-in gate: a session-time check only fires when
// the person actually signs in, so a dormant-but-privileged account could sit
// past its grace window indefinitely without enrolling. The daily sweep closes
// that window deterministically and produces an audit record on every action.
//
// --- Auth (copied verbatim from expire-grants / academia-digest) -----------
// Vercel sends the cron secret as `Authorization: Bearer $CRON_SECRET`.
// HEADER-ONLY (no query-string fallback — secrets must never land in access
// logs). Constant-time compare via node:crypto timingSafeEqual. 500 if the
// secret is unset (failure-closed), 401 on mismatch.
//
// --- Audit actions emitted -------------------------------------------------
// Documented team audit verbs written by this route:
//   'team_mfa_autosuspend' — a privileged member past the grace window had no
//     verified TOTP factor and was auto-banned + suspended by this sweep.
//
// --- Idempotency -----------------------------------------------------------
// The candidate query only selects status='active' rows. Once a member is
// suspended (this sweep or otherwise) they fall out of the candidate set, so a
// re-run suspends nothing new. A member who later enrolls a verified TOTP
// factor is skipped (the MFA check passes). Banning an already-banned auth
// account and re-writing status='suspended' on an already-suspended row are
// both no-op-safe, but in practice neither is re-reached.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { writeTeamAudit } from "@/lib/team/audit";
import { putCronHeartbeat } from "@/lib/cloudwatch";
import type { TeamMember } from "@/lib/team/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 100 years ≈ permanent (matches /api/admin/team/suspend BAN_DURATION).
const BAN_DURATION = "876000h";

// Grace window: a privileged member must enroll verified TOTP within this many
// days of activation (or invite). Logged into the audit metadata.
const GRACE_DAYS = 7;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

// Roles that are required to hold MFA. Mirrors the privileged set: anyone who
// can act inside the product as staff. (lionade_access <> 'none' is the second
// gate, applied in the query.)
const ENFORCED_ROLES: TeamMember["role"][] = ["founder", "engineer", "support"];

// Safety bound on candidates per run. The team is tiny; this is a guardrail,
// not a paging cursor.
const MAX_MEMBERS_PER_RUN = 1000;

// Audit actor for an automated sweep is the system, recorded as a null
// performed_by (the column is a nullable FK to profiles). Expressed as a typed
// null because TeamAuditEntry.performedBy is a required string.
const SYSTEM_ACTOR = null as unknown as string;

// The candidate shape we actually read. user_id is non-null in the result set
// (filtered in the query) but the column type is nullable, so we keep it
// nullable here and re-check before use.
type Candidate = Pick<
  TeamMember,
  "id" | "user_id" | "role" | "lionade_access" | "invited_at" | "activated_at"
>;

export async function GET(req: NextRequest) {
  // --- 1. Auth -----------------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/team-mfa-enforce] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const aBuf = Buffer.from(authHeader);
  const eBuf = Buffer.from(expected);
  if (aBuf.length !== eBuf.length || !timingSafeEqual(aBuf, eBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();

  try {
    // --- 2. Candidate members -------------------------------------------
    // Privileged, currently-active members with a linked auth account. Pending
    // / suspended / offboarded rows and access='none' rows are excluded at the
    // source so the loop only ever touches enforceable accounts.
    const { data: members, error: membersErr } = await supabaseAdmin
      .from("team_members")
      .select("id, user_id, role, lionade_access, invited_at, activated_at")
      .eq("status", "active")
      .neq("lionade_access", "none")
      .in("role", ENFORCED_ROLES)
      .not("user_id", "is", null)
      .limit(MAX_MEMBERS_PER_RUN);

    if (membersErr) {
      console.error("[cron/team-mfa-enforce]", membersErr.message);
      return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
    }

    const candidates = (members ?? []) as Candidate[];

    let checked = 0;
    let suspended = 0;
    let skipped = 0;
    let errors = 0;

    for (const member of candidates) {
      // Each member is isolated: one bad row (auth fault, DB blip) must not
      // abort the batch. We never log the member's user_id alongside identity
      // context that could read as PII; the bare id is the same granularity the
      // sibling crons log on a failed row.
      try {
        const userId = member.user_id;
        if (!userId) {
          // Defensive: the query filters NULL user_id, but re-check before use.
          skipped++;
          continue;
        }
        checked++;

        // Clock start = activated_at when set, else invited_at. If both are
        // null we cannot prove the grace window has elapsed, so we fail OPEN
        // (skip) rather than lock out an account on missing timestamps.
        const startIso = member.activated_at ?? member.invited_at;
        if (!startIso) {
          skipped++;
          continue;
        }
        const startMs = Date.parse(startIso);
        if (Number.isNaN(startMs)) {
          skipped++;
          continue;
        }

        const cutoffMs = startMs + GRACE_MS;
        if (now < cutoffMs) {
          // Still inside the grace window — nothing to enforce yet.
          skipped++;
          continue;
        }

        // --- 3. MFA check -------------------------------------------------
        // Purpose-built admin read of one user's factors via the service-role
        // client. We treat a read error as "cannot confirm compliance", which
        // for a destructive action means fail OPEN (skip) and surface it as an
        // error count rather than risk a wrongful lockout on a transient fault.
        const { data: mfa, error: mfaErr } =
          await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
        if (mfaErr) {
          console.error("[cron/team-mfa-enforce] mfa read failed", userId, mfaErr.message);
          errors++;
          continue;
        }

        const hasVerifiedTotp = (mfa?.factors ?? []).some(
          (f) => f.factor_type === "totp" && f.status === "verified",
        );
        if (hasVerifiedTotp) {
          // Compliant — nothing to do.
          skipped++;
          continue;
        }

        // --- 4. Enforce: ban auth, then suspend membership ---------------
        // Order matches /api/admin/team/suspend: ban the auth account first
        // (the security-critical step, our global session kill), then flip the
        // row. If the row write fails after a successful ban the person is
        // already locked out, which is the safe outcome.
        const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(
          userId,
          { ban_duration: BAN_DURATION },
        );
        if (banErr) {
          console.error("[cron/team-mfa-enforce] auth ban failed", userId, banErr.message);
          errors++;
          continue;
        }

        const { error: statusErr } = await supabaseAdmin
          .from("team_members")
          .update({ status: "suspended" })
          .eq("id", member.id);
        if (statusErr) {
          console.error("[cron/team-mfa-enforce] status update failed", member.id, statusErr.message);
          errors++;
          continue;
        }

        // Append-only audit. The actor is the system (this cron), NOT the
        // member, so performedBy is null: admin_audit_log.performed_by is a
        // nullable FK to profiles(id), and recording the suspended member as
        // the performer would both misstate who acted and risk the FK (the
        // member may not be a profiles row). The member is the target.
        // Metadata carries no secrets and no email/PII — only the machine
        // reason and the grace policy in effect.
        await writeTeamAudit(supabaseAdmin, {
          // System actor: this cron, not a human. admin_audit_log.performed_by
          // is a nullable FK to profiles(id), and writeTeamAudit forwards the
          // value straight into the insert, so a null performer is recorded
          // verbatim and correctly attributes the action to no human. The cast
          // bridges the type-only gap (TeamAuditEntry.performedBy is a required
          // string) without widening the shared interface from one caller.
          performedBy: SYSTEM_ACTOR,
          action: "team_mfa_autosuspend",
          targetUserId: userId,
          metadata: { reason: "mfa_not_enrolled_within_grace", grace_days: GRACE_DAYS },
        });

        suspended++;
      } catch (e) {
        console.error(
          "[cron/team-mfa-enforce] member failed",
          member.id,
          e instanceof Error ? e.message : "unknown",
        );
        errors++;
      }
    }

    const summary = { ok: true, checked, suspended, skipped, errors };
    console.log("[cron/team-mfa-enforce] done", JSON.stringify(summary));
    await putCronHeartbeat("team-mfa-enforce");
    return NextResponse.json(summary);
  } catch (e) {
    console.error(
      "[cron/team-mfa-enforce] unexpected",
      e instanceof Error ? e.message : "unknown",
    );
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
