// POST /api/admin/team/offboard — ADMIN ONLY. Offboard a team member.
//
// Two modes, both partial-failure-safe (each side-effect is independently
// caught; one failure never aborts the rest, and the result reports which steps
// failed so the admin can retry the targeted piece):
//
//   SOFT (default): the reversible "this person left" state.
//     1. team_members.status -> 'offboarded', offboarded_at = now().
//     2. If linked to a Supabase account (user_id): ban the auth user
//        (effectively forever), which revokes all active sessions/refresh
//        tokens server-side.
//     3. Re-point the Cloudflare forwarding rule at the admin fallback inbox
//        so mail to their @getlionade.com address still reaches the team.
//     4. If a profiles row exists for the auth user: profiles.role -> 'former_team'.
//     5. Audit (team_offboard) + notify the offboarded person and Sam.
//   The team_members row is RETAINED (the audit/identity record).
//
//   HARD (hard:true): everything SOFT does, PLUS deletes the Cloudflare routing
//   rule entirely (mail to the address bounces). Audited as team_offboard_hard.
//   We deliberately DO NOT delete the Supabase user or the team_members row —
//   the historical record and the SET NULL FK behaviour are preserved.
//
// Safety gate: the caller must echo back the member's exact username
// (confirmUsername) or we 400 — a typed confirmation against destructive ops.
//
// This route handles NO credential material (offboarding never mints or reads a
// password), so nothing password-like is ever logged, audited, or returned.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";
import {
  assertTrustedOrigin,
  UntrustedOriginError,
} from "@/lib/team/origin-check";
import {
  getEmailProvider,
  isEmailProviderConfigured,
} from "@/lib/team/email-provider";
import type { TeamMember } from "@/lib/team/types";

// Where an offboarded member's mailbox forwards to after their personal
// destination is detached, and where the "X was offboarded" heads-up goes.
const DEFAULT_ADMIN_FORWARD = "support@getlionade.com";

/** Resolve the admin fallback inbox at call time (never at module load). */
function adminForwardEmail(): string {
  return (process.env.ADMIN_FORWARD_EMAIL || "").trim() || DEFAULT_ADMIN_FORWARD;
}

/**
 * Per-step outcome flags surfaced to the caller AND stamped into the audit
 * metadata. `true` = step succeeded, `false` = attempted and failed,
 * `"skipped"` = not applicable (e.g. no linked auth user). The main mutation
 * (status flip) is a hard precondition — if it fails the request 500s before we
 * get here, so it is never reported as a partial failure.
 */
interface OffboardSteps {
  auth_banned: boolean | "skipped";
  sessions_revoked: boolean | "skipped";
  cloudflare_updated: boolean | "skipped";
  cloudflare_deleted: boolean | "skipped";
  profile_demoted: boolean | "skipped";
  notify_member: boolean | "skipped";
  notify_admin: boolean;
}

export async function POST(req: NextRequest) {
  // 1. AuthZ — admin only. requireRole returns a ready NextResponse on failure.
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  // 2. Defense in depth — reject any non-first-party origin before privileged
  //    work. Maps the typed 403 error to a forbidden response.
  try {
    assertTrustedOrigin(req);
  } catch (err) {
    if (err instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: err.status });
    }
    // Unexpected — fail closed.
    console.error("[admin/team/offboard] origin check error");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Body parse.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    id,
    confirmUsername,
    hard: hardRaw,
  } = (body ?? {}) as {
    id?: unknown;
    confirmUsername?: unknown;
    hard?: unknown;
  };

  if (typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json({ error: "Member id is required" }, { status: 400 });
  }
  if (typeof confirmUsername !== "string" || confirmUsername.trim().length === 0) {
    return NextResponse.json(
      { error: "confirmUsername is required" },
      { status: 400 },
    );
  }
  const hard = hardRaw === true;
  const memberId = id.trim();

  // 4. Load the target row (also our existence check).
  const { data: memberRow, error: loadErr } = await supabaseAdmin
    .from("team_members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();

  if (loadErr) {
    console.error("[admin/team/offboard] lookup failed:", loadErr.message);
    return NextResponse.json({ error: "Offboard failed" }, { status: 500 });
  }
  if (!memberRow) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }
  const member = memberRow as TeamMember;

  // 5. Typed-confirmation gate against the live username (case-insensitive,
  //    trimmed). The username is stored lowercase, but normalise defensively.
  if (confirmUsername.trim().toLowerCase() !== member.username.toLowerCase()) {
    return NextResponse.json(
      { error: "Confirmation does not match the member's username." },
      { status: 400 },
    );
  }

  // Idempotency: offboarding an already-offboarded member is a no-op success.
  if (member.status === "offboarded" && !hard) {
    return NextResponse.json({
      ok: true,
      alreadyOffboarded: true,
      mode: "soft",
    });
  }

  // ── 6. MAIN MUTATION (hard precondition) — flip status to offboarded. ──────
  // Everything after this is a best-effort side-effect that must not roll the
  // status flip back. The row is RETAINED in both modes.
  const nowIso = new Date().toISOString();
  const { error: statusErr } = await supabaseAdmin
    .from("team_members")
    .update({ status: "offboarded", offboarded_at: nowIso })
    .eq("id", member.id);

  if (statusErr) {
    console.error("[admin/team/offboard] status update failed:", statusErr.message);
    return NextResponse.json({ error: "Offboard failed" }, { status: 500 });
  }

  const steps: OffboardSteps = {
    auth_banned: "skipped",
    sessions_revoked: "skipped",
    cloudflare_updated: "skipped",
    cloudflare_deleted: "skipped",
    profile_demoted: "skipped",
    notify_member: "skipped",
    notify_admin: false,
  };

  // ── 7. Revoke the Supabase account (only if one is linked). ────────────────
  // 876000h ≈ 100 years — an effectively permanent ban without a delete (delete
  // would null the team_members.user_id via SET NULL and lose the link).
  //
  // The ban IS the session revocation: a banned user's refresh tokens are
  // rejected by the auth server, so all sessions die on next refresh / API call.
  // We deliberately do NOT call auth.admin.signOut here: in supabase-js 2.97 its
  // signature is signOut(jwt, scope) — it takes a logged-in JWT, NOT a user id,
  // and there is no admin "sign out by user id" primitive. Passing member.user_id
  // would typecheck (both strings) yet silently revoke nothing. So sessions_revoked
  // mirrors the ban outcome rather than a separate no-op call.
  if (member.user_id) {
    try {
      const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(
        member.user_id,
        { ban_duration: "876000h" },
      );
      const banned = !banErr;
      steps.auth_banned = banned;
      // Banning invalidates all of the user's sessions/refresh tokens.
      steps.sessions_revoked = banned;
      if (banErr) {
        console.error("[admin/team/offboard] ban failed:", banErr.message);
      }
    } catch {
      steps.auth_banned = false;
      steps.sessions_revoked = false;
      console.error("[admin/team/offboard] ban threw for member:", member.id);
    }
  }

  // ── 8. Cloudflare forwarding rule. ─────────────────────────────────────────
  // SOFT: re-point the rule at the admin fallback inbox (mail keeps flowing to
  //       the team). HARD: delete the rule outright (mail bounces).
  // Only attempted when (a) the provider is configured and (b) we have a stored
  // rule id. A missing-config or missing-id is "skipped", not a failure.
  if (member.cloudflare_address_id && isEmailProviderConfigured()) {
    try {
      const provider = getEmailProvider();
      if (hard) {
        await provider.deleteAddress(member.cloudflare_address_id);
        steps.cloudflare_deleted = true;
      } else {
        await provider.updateForwardingDestination(
          member.cloudflare_address_id,
          adminForwardEmail(),
        );
        steps.cloudflare_updated = true;
      }
    } catch (err) {
      // The email-provider helper throws Errors with clean, secret-free
      // messages (it never embeds the token). Safe to log; not echoed to client.
      const reason = err instanceof Error ? err.message : "unknown error";
      console.error("[admin/team/offboard] cloudflare step failed:", reason);
      if (hard) steps.cloudflare_deleted = false;
      else steps.cloudflare_updated = false;
    }
  }

  // ── 9. Demote the profiles row (only if a profile exists for the auth user). ─
  // profiles.id == auth.users.id in this codebase, so we key on user_id.
  if (member.user_id) {
    try {
      const { data: profileRow, error: profileLookupErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", member.user_id)
        .maybeSingle();

      if (profileLookupErr) {
        console.error(
          "[admin/team/offboard] profile lookup failed:",
          profileLookupErr.message,
        );
        steps.profile_demoted = false;
      } else if (profileRow) {
        const { error: demoteErr } = await supabaseAdmin
          .from("profiles")
          .update({ role: "former_team" })
          .eq("id", member.user_id);
        steps.profile_demoted = demoteErr ? false : true;
        if (demoteErr) {
          console.error(
            "[admin/team/offboard] profile demote failed:",
            demoteErr.message,
          );
        }
      }
      // profileRow null -> stays "skipped" (no profile to demote).
    } catch {
      steps.profile_demoted = false;
      console.error(
        "[admin/team/offboard] profile demote threw for member:",
        member.id,
      );
    }
  }

  // ── 10. Notifications (offboarded person + Sam). Best-effort. ───────────────
  await sendOffboardNotifications(member, hard, steps);

  // ── 11. Audit AFTER the work — records what actually happened, including the
  //        per-step partial-failure flags. No password material is involved.
  const audit = await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: hard ? "team_offboard_hard" : "team_offboard",
    // Link the audit to the underlying auth/profile id when present.
    targetUserId: member.user_id ?? null,
    metadata: {
      team_member_id: member.id,
      username: member.username,
      email_address: member.email_address,
      previous_role: member.role,
      previous_status: member.status,
      hard,
      steps,
    },
  });

  // 12. Compute a single "any partial failure" flag for the UI to surface a
  //     "completed with warnings" state. A `false` in any step means an
  //     attempted-but-failed side effect that the admin may want to retry.
  const partialFailure =
    Object.values(steps).some((v) => v === false) || !audit.ok;

  return NextResponse.json({
    ok: true,
    mode: hard ? "hard" : "soft",
    teamMemberId: member.id,
    username: member.username,
    steps,
    auditLogged: audit.ok,
    partialFailure,
  });
}

/**
 * Send the two heads-up emails (offboarded member + admin/Sam). Entirely
 * best-effort: each send is independently caught and recorded in `steps`; a
 * Resend or config gap never affects the offboard outcome. Mutates `steps` in
 * place with notify_member / notify_admin results.
 *
 * No credential material is present in either message (offboarding mints none).
 */
async function sendOffboardNotifications(
  member: TeamMember,
  hard: boolean,
  steps: OffboardSteps,
): Promise<void> {
  // Env-gated at call time. Missing config -> log + leave flags as-is (member
  // stays "skipped", admin stays false) rather than throw.
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.warn(
      "[admin/team/offboard] RESEND_API_KEY or EMAIL_FROM missing — skipping notifications",
    );
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM;
  const adminInbox = adminForwardEmail();
  const displayName = member.full_name?.trim() || member.username;

  // ── Member notification (only if we have a personal destination). ──────────
  if (member.personal_email && member.personal_email.trim().length > 0) {
    const memberMsg = renderMemberOffboardEmail(member, hard);
    try {
      const { error } = await resend.emails.send({
        from,
        to: member.personal_email.trim(),
        replyTo: adminInbox,
        subject: memberMsg.subject,
        html: memberMsg.html,
        text: memberMsg.text,
      });
      steps.notify_member = error ? false : true;
      if (error) {
        console.warn(
          "[admin/team/offboard] member notify failed:",
          JSON.stringify(error),
        );
      }
    } catch {
      steps.notify_member = false;
      console.warn("[admin/team/offboard] member notify threw");
    }
  }

  // ── Admin/Sam notification (always attempted). ─────────────────────────────
  const adminMsg = renderAdminOffboardEmail(member, hard, displayName);
  try {
    const { error } = await resend.emails.send({
      from,
      to: adminInbox,
      subject: adminMsg.subject,
      html: adminMsg.html,
      text: adminMsg.text,
    });
    steps.notify_admin = error ? false : true;
    if (error) {
      console.warn(
        "[admin/team/offboard] admin notify failed:",
        JSON.stringify(error),
      );
    }
  } catch {
    steps.notify_admin = false;
    console.warn("[admin/team/offboard] admin notify threw");
  }
}

/** HTML-escape a dynamic string before it lands in an email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface RenderedNotice {
  subject: string;
  html: string;
  text: string;
}

/**
 * Plain, warm note to the departing member. Minimal chrome (no credentials, no
 * CTA) — just confirmation their access is closed and where mail now goes. Copy
 * deliberately avoids em-dashes per project copy rules.
 */
function renderMemberOffboardEmail(
  member: TeamMember,
  hard: boolean,
): RenderedNotice {
  const name = escapeHtml(member.full_name?.trim() || "there");
  const address = escapeHtml(member.email_address);
  const mailLine = hard
    ? "Your Lionade address has been closed, so new mail to it will no longer be delivered."
    : "Mail to your Lionade address is now forwarded to the team rather than to you.";

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;">
<p style="margin:0 0 16px 0;">Hi ${name},</p>
<p style="margin:0 0 16px 0;">Your access to Lionade systems has been wound down and your team account is now closed. Thank you for everything you contributed.</p>
<p style="margin:0 0 16px 0;">${mailLine}</p>
<p style="margin:0 0 16px 0;">If you think this happened by mistake, reply to this email and it reaches the team.</p>
<p style="margin:24px 0 0 0;color:#777;font-size:13px;">Lionade · getlionade.com</p>
</body></html>`;

  const text = `Hi ${member.full_name?.trim() || "there"},

Your access to Lionade systems has been wound down and your team account is now closed. Thank you for everything you contributed.

${hard
    ? `Your Lionade address (${member.email_address}) has been closed, so new mail to it will no longer be delivered.`
    : `Mail to your Lionade address (${member.email_address}) is now forwarded to the team rather than to you.`}

If you think this happened by mistake, reply to this email and it reaches the team.

Lionade · getlionade.com
`;

  return {
    subject: "Your Lionade team access has been closed",
    html,
    text,
  };
}

/** Internal heads-up to Sam summarising the offboard + any partial failures. */
function renderAdminOffboardEmail(
  member: TeamMember,
  hard: boolean,
  displayName: string,
): RenderedNotice {
  const name = escapeHtml(displayName);
  const address = escapeHtml(member.email_address);
  const username = escapeHtml(member.username);
  const mode = hard ? "Hard offboard" : "Offboard";

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;">
<p style="margin:0 0 16px 0;"><strong>${mode} completed.</strong></p>
<p style="margin:0 0 8px 0;">Member: ${name} (${username})</p>
<p style="margin:0 0 8px 0;">Address: ${address}</p>
<p style="margin:0 0 16px 0;">${hard
    ? "The forwarding rule was removed, so mail to this address now bounces."
    : "The forwarding rule now points at the team inbox."}</p>
<p style="margin:24px 0 0 0;color:#777;font-size:13px;">Lionade admin · internal notification</p>
</body></html>`;

  const text = `${mode} completed.

Member: ${displayName} (${member.username})
Address: ${member.email_address}

${hard
    ? "The forwarding rule was removed, so mail to this address now bounces."
    : "The forwarding rule now points at the team inbox."}

Lionade admin · internal notification
`;

  return {
    subject: `${mode}: ${displayName} (${member.username})`,
    html,
    text,
  };
}
