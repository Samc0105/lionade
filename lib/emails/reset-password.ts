/**
 * Shared "reset your Lionade password" email renderer.
 *
 * Extracted from app/api/admin/team/reset-password so the team-reset route AND
 * the user/support reset route render an identical, on-brand email from ONE
 * place. Both routes mint a one-time Supabase recovery link via
 * supabaseAdmin.auth.admin.generateLink and deliver it over Resend (the app's
 * transactional provider) — deliberately NOT Supabase's built-in/custom SMTP,
 * so the highest-value auth email never depends on the dashboard SMTP config.
 *
 * SECURITY: the reset URL is bearer-equivalent (anyone holding it can set the
 * account password until it is consumed/expires). Callers must NEVER log the
 * returned html/text or the url. The email body is the only delivery channel.
 */
import { Resend } from "resend";
import { BRAND } from "@/lib/emails";
import { SITE_HOST, SUPPORT_EMAIL } from "@/lib/site-config";

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
 * Gold CTA button matching the rest of the email suite. The exported render.ts
 * ctaButton() uses {{ctaUrl}}/{{ctaLabel}} template slots (template-author
 * surface), so this operator email defines its own arg-taking variant — same
 * approach as lib/emails/team-welcome.tsx.
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

export interface RenderResetEmailArgs {
  /** Recipient display name for the greeting; null/empty falls back to "there". */
  fullName: string | null;
  /** The one-time recovery URL. Bearer-equivalent — never log this. */
  resetUrl: string;
  /**
   * Footer "you're receiving this because…" line. Team resets pass the
   * team-membership reason; a normal user reset uses the account default.
   */
  receivingBecause?: string;
}

/**
 * Renders the "reset your Lionade password" email. Reuses the shared BRAND
 * palette + ctaButton so it matches the rest of the transactional suite (no new
 * email framework — per CLAUDE_AGENT.md). The reset URL is the single sensitive
 * value; callers must not log this html/text.
 */
export function renderResetEmail(args: RenderResetEmailArgs): {
  subject: string;
  html: string;
  text: string;
} {
  const safeName = (args.fullName || "").trim();
  const greeting = safeName.length > 0 ? escapeHtml(safeName) : "there";
  // Greeting for the plaintext part (subject is a constant, so this is NOT the
  // subject line despite living next to it).
  const textGreetingName = safeName.length > 0 ? safeName : "there";
  const receivingBecause =
    args.receivingBecause ??
    "You're receiving this because a password reset was requested for your Lionade account.";
  const receivingBecauseEsc = escapeHtml(receivingBecause);

  const bodyHtml = `
<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;font-weight:700;color:${BRAND.ink};">
  Reset your Lionade password
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:${BRAND.ink};">
  Hi ${greeting}, a password reset was started for your Lionade login.
  Click below to set a new password.
</p>
${ctaButton(args.resetUrl, "Set a new password")}
<p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
  This link is one-time use and expires shortly. If it has expired by the time
  you click it, ask for a fresh one.
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
              ${receivingBecauseEsc} Lionade &middot; ${escapeHtml(SITE_HOST)}.
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

Hi ${textGreetingName}, a password reset was started for your Lionade login.
Open this one-time link to set a new password:

${args.resetUrl}

This link is one-time use and expires shortly. If it has expired, ask for a fresh one.

If you didn't expect this, ignore this email (your password won't change until you open the link) and tell ${SUPPORT_EMAIL}.

${receivingBecause} Lionade · ${SITE_HOST}
`;

  return { subject: "Reset your Lionade password", html, text };
}

export interface SendResetEmailArgs {
  /** Resend API key (read at call time by the route, never at module load). */
  resendKey: string;
  /** Verified `from` address (EMAIL_FROM). */
  emailFrom: string;
  /** Recipient address. */
  to: string;
  /** Greeting name, or null for "there". */
  fullName: string | null;
  /** One-time recovery URL. Bearer-equivalent — never logged. */
  resetUrl: string;
  /** Optional footer reason override (team vs generic account). */
  receivingBecause?: string;
  /** Log prefix, e.g. "admin/reset-password". */
  logTag: string;
}

/**
 * Render + deliver the reset email over Resend. Shared by both admin reset
 * routes so the delivery mechanics (render, send, error logging) live in ONE
 * place. Returns true on a confirmed send, false on any Resend error/throw —
 * the caller decides the HTTP status (the team route treats a false as
 * non-fatal when it also reveals the link to the admin; the user route treats
 * false as a hard 502). NEVER logs the resetUrl or the rendered body.
 */
export async function sendResetEmail(args: SendResetEmailArgs): Promise<boolean> {
  const rendered = renderResetEmail({
    fullName: args.fullName,
    resetUrl: args.resetUrl,
    receivingBecause: args.receivingBecause,
  });
  try {
    const resend = new Resend(args.resendKey);
    const { error: sendErr } = await resend.emails.send({
      from: args.emailFrom,
      to: args.to,
      replyTo: SUPPORT_EMAIL,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (sendErr) {
      // Log a safe summary of the provider error only — never the link/body.
      console.error(`[${args.logTag}] resend send failed:`, JSON.stringify(sendErr));
      return false;
    }
    return true;
  } catch (sendEx) {
    console.error(
      `[${args.logTag}] resend threw:`,
      sendEx instanceof Error ? sendEx.message : "unknown",
    );
    return false;
  }
}
