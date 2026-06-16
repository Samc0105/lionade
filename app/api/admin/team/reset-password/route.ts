/**
 * POST /api/admin/team/reset-password — admin-triggered password reset for a
 * team member's Lionade login.
 *
 * What it does:
 *   1. Gates on requireRole(req, "admin") + assertTrustedOrigin (defense in
 *      depth — these are the most sensitive routes in the product).
 *   2. Looks up the target team_members row by id. The member must already be
 *      linked to an auth.users account (user_id) AND have a personal_email to
 *      deliver to; otherwise there is nothing to reset / nowhere to send.
 *   3. Mints a ONE-TIME Supabase recovery link via
 *      supabaseAdmin.auth.admin.generateLink({ type: "recovery", ... }) against
 *      the member's PERSONAL email (the canonical auth identity), then emails
 *      that link to the personal inbox via Resend.
 *   4. Re-arms must_change_password = true so the next sign-in forces a fresh
 *      permanent password.
 *   5. Audits the action as `team_password_reset`.
 *
 * SECURITY — credential hygiene (matches lib/team/password.ts + audit.ts):
 *   The recovery link is bearer-equivalent: anyone holding it can set the
 *   account's password until it is consumed/expires. So it is treated like a
 *   secret. It is NEVER written to logs, NEVER placed in admin_audit_log
 *   metadata, and only returned in the HTTP response when the admin explicitly
 *   asks (showLinkToAdmin) — and even then only to an already admin-gated
 *   caller. The email body is the intended delivery channel; we do not log it.
 *
 * Env-gated at CALL time (never at module load, so a missing var degrades to a
 * clear error instead of crashing the route file on import):
 *   RESEND_API_KEY, EMAIL_FROM.
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, isUuid } from "@/lib/admin-auth";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import { writeTeamAudit } from "@/lib/team/audit";
import { BRAND } from "@/lib/emails";
import { absoluteUrl, SITE_HOST, SUPPORT_EMAIL } from "@/lib/site-config";

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** HTML-escape a dynamic string before it lands in the email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Gold CTA button matching the rest of the email suite, with a passed-in href +
 * label. The exported render.ts `ctaButton()` uses {{ctaUrl}}/{{ctaLabel}}
 * template slots (template-author surface), so this operator email defines its
 * own arg-taking variant — same approach as lib/emails/team-welcome.tsx.
 */
function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
  <tr>
    <td align="center" style="border-radius:8px;background:${BRAND.goldDark};">
      <a href="${url}"
         style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;background:${BRAND.goldDark};">
        ${label} &rarr;
      </a>
    </td>
  </tr>
</table>`;
}

/**
 * Renders the operator-facing "reset your Lionade password" email. Reuses the
 * shared BRAND palette + ctaButton so it matches the rest of the transactional
 * suite (no new email framework — per CLAUDE_AGENT.md). The reset URL is the
 * single sensitive value; callers must not log this html/text.
 */
function renderResetEmail(args: {
  fullName: string | null;
  resetUrl: string;
}): { subject: string; html: string; text: string } {
  const safeName = (args.fullName || "").trim();
  const greeting = safeName.length > 0 ? escapeHtml(safeName) : "there";
  const subjectName = safeName.length > 0 ? safeName : "team";
  const resetUrlEsc = escapeHtml(args.resetUrl);

  const bodyHtml = `
<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;font-weight:700;color:${BRAND.ink};">
  Reset your Lionade password
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:${BRAND.ink};">
  Hi ${greeting}, an admin started a password reset for your Lionade login.
  Click below to set a new password.
</p>
${ctaButton(args.resetUrl, "Set a new password")}
<p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
  This link is one-time use and expires shortly. If it has expired by the time
  you click it, ask the admin who sent it for a fresh one.
</p>
<p style="margin:0 0 4px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
  If you didn't expect this, you can ignore the email and tell
  <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.goldDark};text-decoration:underline;">${SUPPORT_EMAIL}</a>.
  Your password won't change until you open the link and set one.
</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>Lionade</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:${FONT_STACK};color:${BRAND.ink};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.cream};">
Set a new password for your Lionade login.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px 20px 32px;border-bottom:1px solid ${BRAND.border};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left" valign="middle">
                  <img src="${BRAND.logoUrl}" width="40" height="40" alt="Lionade" style="display:block;border:0;outline:none;text-decoration:none;height:40px;width:40px;" />
                </td>
                <td align="right" valign="middle" style="font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${BRAND.goldDark};letter-spacing:0.12em;text-transform:uppercase;">
                  Lionade
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="height:4px;background:linear-gradient(90deg, ${BRAND.gold} 0%, ${BRAND.goldDark} 100%);background-color:${BRAND.gold};font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:36px 32px 32px 32px;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${BRAND.ink};">
${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;background:${BRAND.parchment};border-top:1px solid ${BRAND.border};font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${BRAND.muted};">
            <p style="margin:0 0 8px 0;color:${BRAND.muted};font-size:12px;">
              Questions? Email
              <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.goldDark};text-decoration:underline;">${SUPPORT_EMAIL}</a>.
            </p>
            <p style="margin:0;color:${BRAND.muted};font-size:11px;opacity:0.8;">
              You're receiving this because you're on the Lionade team. Lionade &middot; ${escapeHtml(SITE_HOST)}.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `Reset your Lionade password

Hi ${subjectName}, an admin started a password reset for your Lionade login.
Open this one-time link to set a new password:

${args.resetUrl}

This link is one-time use and expires shortly. If it has expired, ask the admin who sent it for a fresh one.

If you didn't expect this, ignore this email (your password won't change until you open the link) and tell ${SUPPORT_EMAIL}.

Lionade · ${SITE_HOST}
`;

  return { subject: "Reset your Lionade password", html, text };
}

export async function POST(req: NextRequest) {
  // --- 1. Auth: admin only --------------------------------------------------
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  // --- 2. Defense in depth: trusted origin ---------------------------------
  try {
    assertTrustedOrigin(req);
  } catch (err) {
    if (err instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: err.status });
    }
    throw err;
  }

  // --- 3. Parse + validate body --------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { id, showLinkToAdmin } = body as { id?: unknown; showLinkToAdmin?: unknown };

  if (typeof id !== "string" || !isUuid(id)) {
    return NextResponse.json({ error: "A valid team member id is required" }, { status: 400 });
  }
  if (showLinkToAdmin !== undefined && typeof showLinkToAdmin !== "boolean") {
    return NextResponse.json({ error: "showLinkToAdmin must be a boolean" }, { status: 400 });
  }
  const revealLink = showLinkToAdmin === true;

  // --- 4. Env gate (read at CALL time) -------------------------------------
  const resendKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!resendKey) {
    return NextResponse.json(
      { error: "Email not configured: set RESEND_API_KEY" },
      { status: 503 },
    );
  }
  if (!emailFrom) {
    return NextResponse.json(
      { error: "Email not configured: set EMAIL_FROM" },
      { status: 503 },
    );
  }

  // --- 5. Load the target team member --------------------------------------
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("team_members")
    .select("id, user_id, full_name, personal_email, status")
    .eq("id", id)
    .maybeSingle();

  if (memberErr) {
    console.error("[team/reset-password]", memberErr.message);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  // Narrow the supabase-js row to the fields we read. The project doesn't
  // generate Database generics, so select() returns a loosely-typed row; this
  // structural cast names the columns we depend on (no `any` introduced).
  const row = member as {
    user_id: string | null;
    full_name: string | null;
    personal_email: string | null;
  };

  // Must be linked to a real auth account to have a password to reset.
  if (!row.user_id) {
    return NextResponse.json(
      { error: "This member has no linked login account to reset" },
      { status: 400 },
    );
  }
  // Recovery is keyed off the auth identity (their personal email) and that is
  // also where the link is delivered. No personal_email => nothing to do.
  const personalEmail = (row.personal_email || "").trim();
  if (!personalEmail) {
    return NextResponse.json(
      { error: "This member has no personal email on file to send the reset to" },
      { status: 400 },
    );
  }

  // --- 6. Mint the one-time recovery link ----------------------------------
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: personalEmail,
    options: { redirectTo: absoluteUrl("/reset-password") },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error("[team/reset-password]", linkErr?.message ?? "no action_link returned");
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
  const resetUrl = linkData.properties.action_link;

  // --- 7. Deliver the link via Resend --------------------------------------
  const rendered = renderResetEmail({ fullName: row.full_name, resetUrl });
  let emailSent = false;
  try {
    const resend = new Resend(resendKey);
    const { error: sendErr } = await resend.emails.send({
      from: emailFrom,
      to: personalEmail,
      replyTo: SUPPORT_EMAIL,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (sendErr) {
      // Don't echo provider detail to the client; log a safe summary only.
      console.error("[team/reset-password] resend send failed:", JSON.stringify(sendErr));
    } else {
      emailSent = true;
    }
  } catch (sendEx) {
    // Never include the link/exception body in the response.
    console.error(
      "[team/reset-password] resend threw:",
      sendEx instanceof Error ? sendEx.message : "unknown",
    );
  }

  // If the admin asked to see the link, the email delivery is a convenience, so
  // a send failure is non-fatal. If they did NOT ask, the email is the only
  // delivery path, so a failure must surface as an error.
  if (!emailSent && !revealLink) {
    return NextResponse.json({ error: "Could not send the reset email" }, { status: 502 });
  }

  // --- 8. Re-arm must_change_password --------------------------------------
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabaseAdmin
    .from("team_members")
    .update({ must_change_password: true, updated_at: nowIso })
    .eq("id", id);

  const mustChangeFlagSet = !updateErr;
  if (updateErr) {
    // The recovery link is already valid and (usually) sent; losing the flag
    // doesn't undo the reset, so don't fail the request. Flag it in the audit.
    console.error("[team/reset-password]", updateErr.message);
  }

  // --- 9. Audit (NEVER the link or any password) ---------------------------
  await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "team_password_reset",
    targetUserId: row.user_id,
    metadata: {
      team_member_id: id,
      delivery: "email",
      email_sent: emailSent,
      link_revealed_to_admin: revealLink,
      must_change_password_set: mustChangeFlagSet,
    },
  });

  // --- 10. Respond ---------------------------------------------------------
  // resetLink is included ONLY when the admin explicitly opted in. The route is
  // already admin-gated, so this stays within the trust boundary. It is never
  // logged or audited.
  const response: {
    ok: true;
    emailSent: boolean;
    mustChangePassword: true;
    resetLink?: string;
  } = {
    ok: true,
    emailSent,
    mustChangePassword: true,
  };
  if (revealLink) {
    response.resetLink = resetUrl;
  }
  return NextResponse.json(response);
}
