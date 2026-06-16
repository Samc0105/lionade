/**
 * Team welcome email - sent when an admin onboards a new team member via the
 * internal Admin → Team management screen (feat/admin-team-management).
 *
 * This is an OPERATOR email (sent to a colleague, not a Lionade end user), so
 * it lives at the top of lib/emails rather than under templates/ and ships its
 * own typed render function instead of plugging into the shared {{slot}}
 * `EmailSlots` shape - its inputs (username, temporary Lionade password, the
 * one-time reset URL, the SMTP setup block) are bespoke and partly conditional
 * (the password + reset button only render when Lionade access was granted).
 *
 * It DELIBERATELY reuses lib/emails/render's `BRAND` constants and the same
 * table-based, inline-styled, 600px, Gmail/Outlook-safe HTML conventions so it
 * stays visually identical to the rest of the transactional suite. We do NOT
 * reinvent the email framework here (per CLAUDE_AGENT.md - "no @react-email,
 * no mjml"); the `.tsx` extension is for module placement only, there is no JSX.
 *
 * SECURITY: the temporary password is rendered into the email body (that is the
 * delivery channel by design) but the SMTP password is NEVER embedded - it is
 * delivered separately by Sam out of band. Callers MUST NOT log this email's
 * `html`/`text` anywhere, and the temp password must never reach
 * admin_audit_log, error messages, or API responses.
 */
import { BRAND } from "./render";

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export type TeamWelcomeInput = {
  /** Display name for the greeting, e.g. "Riya". Falls back to "there". */
  fullName?: string | null;
  /** The new @getlionade.com address, e.g. "riya". Rendered as riya@getlionade.com. */
  username: string;
  /** Email-routing domain - defaults to getlionade.com if omitted. */
  emailDomain?: string;
  /**
   * Whether this member was granted Lionade app access. When false, the
   * temporary-password block and the "Set your permanent password" button are
   * omitted entirely (a routing-only / forwarding-only member never logs in).
   */
  lionadeAccessGranted: boolean;
  /**
   * The one-time temporary Lionade password. REQUIRED when
   * lionadeAccessGranted is true; ignored otherwise. Rendered once in the body.
   */
  temporaryPassword?: string | null;
  /**
   * Absolute one-time "set your permanent password" reset URL. REQUIRED when
   * lionadeAccessGranted is true; ignored otherwise.
   */
  passwordResetUrl?: string | null;
};

export type RenderedTeamWelcome = {
  subject: string;
  html: string;
  text: string;
};

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
 * Same header/footer chrome as lib/emails/render's baseLayout, kept local so
 * this operator email can carry an internal-tool footer note instead of the
 * consumer "you signed up at getlionade.com" line.
 */
function teamLayout({
  preheader,
  bodyHtml,
}: {
  preheader: string;
  bodyHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>Lionade</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:${FONT_STACK};color:${BRAND.ink};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.cream};">
${preheader}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
        <!-- Header -->
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
        <!-- Gold accent strip -->
        <tr>
          <td style="height:4px;background:linear-gradient(90deg, ${BRAND.gold} 0%, ${BRAND.goldDark} 100%);background-color:${BRAND.gold};font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <!-- Body slot -->
        <tr>
          <td style="padding:36px 32px 32px 32px;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${BRAND.ink};">
${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px;background:${BRAND.parchment};border-top:1px solid ${BRAND.border};font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${BRAND.muted};">
            <p style="margin:0 0 8px 0;color:${BRAND.muted};font-size:12px;">
              Need a hand getting set up? Email
              <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.goldDark};text-decoration:underline;">${BRAND.supportEmail}</a>.
            </p>
            <p style="margin:0 0 8px 0;color:${BRAND.muted};font-size:12px;">
              <a href="${BRAND.siteUrl}" style="color:${BRAND.goldDark};text-decoration:underline;">getlionade.com</a>
            </p>
            <p style="margin:0;color:${BRAND.muted};font-size:11px;opacity:0.8;">
              You're receiving this because you were added to the Lionade team.
              Lionade &middot; Study rewards.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Gold CTA button matching render.ts `ctaButton`, with a passed-in href + label. */
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
 * Build the welcome email for a newly onboarded team member.
 *
 * Returns rendered { subject, html, text } ready to hand to Resend. Throws if a
 * required input is missing for the chosen access level - fail loud at the call
 * site rather than send a broken email that leaks an empty password slot.
 */
export function renderTeamWelcomeEmail(input: TeamWelcomeInput): RenderedTeamWelcome {
  const domain = (input.emailDomain || "getlionade.com").trim();
  const safeName = (input.fullName || "").trim();
  const greetingName = safeName.length > 0 ? escapeHtml(safeName) : "there";
  const subjectName = safeName.length > 0 ? safeName : "team";

  const username = input.username.trim();
  const newAddress = `${username}@${domain}`;
  const newAddressEsc = escapeHtml(newAddress);

  // ── Access-conditional credentials block ────────────────────────────────
  let credentialsHtml = "";
  let credentialsText = "";
  if (input.lionadeAccessGranted) {
    const tempPassword = (input.temporaryPassword || "").trim();
    const resetUrl = (input.passwordResetUrl || "").trim();
    if (!tempPassword) {
      throw new Error(
        "renderTeamWelcomeEmail: temporaryPassword is required when lionadeAccessGranted is true"
      );
    }
    if (!resetUrl) {
      throw new Error(
        "renderTeamWelcomeEmail: passwordResetUrl is required when lionadeAccessGranted is true"
      );
    }
    const tempPasswordEsc = escapeHtml(tempPassword);

    credentialsHtml = `
<h2 style="margin:28px 0 12px 0;font-size:18px;line-height:1.3;font-weight:700;color:${BRAND.ink};">
  Your Lionade login
</h2>
<p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:${BRAND.ink};">
  Sign in with your new address and this temporary password. You will be asked
  to set a permanent one the first time you log in.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:8px;">
  <tr>
    <td style="padding:16px 18px;font-size:15px;line-height:1.7;color:${BRAND.ink};">
      <span style="color:${BRAND.muted};font-size:13px;">Email</span><br/>
      <strong style="font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;font-size:15px;color:${BRAND.ink};">${newAddressEsc}</strong>
      <br/><br/>
      <span style="color:${BRAND.muted};font-size:13px;">Temporary password</span><br/>
      <strong style="font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;font-size:15px;color:${BRAND.ink};">${tempPasswordEsc}</strong>
    </td>
  </tr>
</table>
<p style="margin:0 0 4px 0;font-size:15px;line-height:1.65;color:${BRAND.ink};">
  Set your permanent password now so this temporary one stops working:
</p>
${ctaButton(resetUrl, "Set your permanent password")}
<p style="margin:0 0 18px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
  This link is one-time use. If it has expired by the time you click it, ask the
  admin who invited you to send a fresh one.
</p>`;

    credentialsText = `Your Lionade login
Email: ${newAddress}
Temporary password: ${tempPassword}

Set your permanent password (one-time link): ${resetUrl}
You will be asked to change the temporary password on first login.

`;
  }

  // ── Collapsible SMTP setup block (Gmail send-as) ────────────────────────
  // <details> is supported in Apple Mail + most modern clients; clients that
  // ignore it just render the steps expanded, which is fine.
  const smtpHtml = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 4px 0;">
  <tr>
    <td style="padding:0;">
      <details style="background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:8px;padding:14px 18px;">
        <summary style="cursor:pointer;font-size:15px;font-weight:700;color:${BRAND.goldDark};list-style:none;">
          Set up sending email from @${escapeHtml(domain)}
        </summary>
        <div style="margin-top:12px;font-size:14px;line-height:1.7;color:${BRAND.ink};">
          <p style="margin:0 0 10px 0;font-size:14px;line-height:1.65;color:${BRAND.ink};">
            Your address receives mail right away. To also <strong>send</strong> from
            ${newAddressEsc} inside Gmail, add it as a "Send mail as" account:
          </p>
          <ol style="margin:0 0 12px 0;padding-left:20px;font-size:14px;line-height:1.7;color:${BRAND.ink};">
            <li>In Gmail, open Settings, then "Accounts and Import".</li>
            <li>Under "Send mail as", click "Add another email address".</li>
            <li>Name: your full name. Email address: <strong>${newAddressEsc}</strong>. Leave "Treat as an alias" checked, then click Next.</li>
            <li>Enter the SMTP server settings below, then click "Add Account".</li>
            <li>Gmail sends a confirmation code to ${newAddressEsc}. It lands in your Lionade inbox. Paste the code to finish.</li>
          </ol>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 10px 0;background:#FFFFFF;border:1px solid ${BRAND.border};border-radius:6px;">
            <tr>
              <td style="padding:12px 14px;font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;font-size:13px;line-height:1.8;color:${BRAND.ink};">
                SMTP server: smtp.resend.com<br/>
                Port: 465<br/>
                Username: resend<br/>
                Password: provided separately by Sam<br/>
                Connection: SSL
              </td>
            </tr>
          </table>
          <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
            The SMTP password is sent to you out of band, not in this email. If
            you do not have it yet, ask Sam.
          </p>
        </div>
      </details>
    </td>
  </tr>
</table>`;

  const smtpText = `Set up sending email from @${domain} (optional)
Your address receives mail right away. To also SEND from ${newAddress} in Gmail:
1. Gmail Settings > Accounts and Import.
2. Under "Send mail as", click "Add another email address".
3. Name: your full name. Email: ${newAddress}. Keep "Treat as an alias" checked. Next.
4. Enter the SMTP settings below, then "Add Account".
5. Gmail emails a confirmation code to ${newAddress} (it lands in your Lionade inbox). Paste it to finish.

SMTP server: smtp.resend.com
Port: 465
Username: resend
Password: provided separately by Sam
Connection: SSL

The SMTP password is sent out of band, not in this email. Ask Sam if you do not have it.

`;

  // ── Assemble body ───────────────────────────────────────────────────────
  const bodyHtml = `
<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:${BRAND.ink};">
  Welcome to the Lionade team, ${greetingName}.
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:${BRAND.ink};">
  You are all set up. Your new Lionade address is live:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
  <tr>
    <td style="padding:14px 18px;background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:8px;font-size:16px;line-height:1.5;color:${BRAND.ink};">
      <strong style="font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;color:${BRAND.goldDark};">${newAddressEsc}</strong>
    </td>
  </tr>
</table>
<p style="margin:0 0 8px 0;font-size:15px;line-height:1.65;color:${BRAND.ink};">
  Mail to that address forwards to your personal inbox automatically. There is
  nothing to install to start receiving.
</p>
${credentialsHtml}
${smtpHtml}
<p style="margin:22px 0 0 0;font-size:14px;line-height:1.6;color:${BRAND.muted};">
  Anything unclear? Reply to this email and it reaches the team.
</p>`;

  const credentialsTextBlock = input.lionadeAccessGranted
    ? `\n${credentialsText}`
    : "\nNo Lionade app login was set up for this address (forwarding only).\n";

  const text = `Welcome to the Lionade team, ${subjectName}.

You are all set up. Your new Lionade address is live:
${newAddress}

Mail to that address forwards to your personal inbox automatically. Nothing to install to start receiving.
${credentialsTextBlock}
${smtpText}Anything unclear? Reply to this email and it reaches the team.

Lionade · getlionade.com
`;

  return {
    subject: `Welcome to Lionade, ${subjectName}`,
    html: teamLayout({
      preheader: `Your ${newAddress} address is live. Here's how to get going.`,
      bodyHtml,
    }),
    text,
  };
}
