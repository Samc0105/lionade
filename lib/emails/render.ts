/**
 * Lionade transactional email renderer.
 *
 * Plain HTML strings + a typed slot interpolator. NO external email framework
 * (no @react-email, no mjml). Per CLAUDE_AGENT.md + Phase 1 directive:
 * "logo + light polish," not a framework rewrite.
 *
 * Conventions:
 *  - All templates are table-based (Outlook + Gmail safe), 600px max width,
 *    inline styles only.
 *  - Logo is hot-linked via the CDN (Gmail strips relative URLs).
 *  - Light cream/parchment background with gold accents — survives dark-mode
 *    email clients far better than a dark theme would.
 *  - Slots use `{{slotName}}` (double-brace). Missing slots throw in dev,
 *    silently render empty in prod (we'd rather ship a slightly broken email
 *    than 500 a user-facing API route).
 *
 * Phase 2 hook: `extras.aiPersonalization` slot is reserved on every body
 * template — AI-generated paragraph plugs in here without a skeleton refactor.
 */
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/site-config";

// ─── Brand constants ─────────────────────────────────────────────────────
// Hot-linked absolute URLs only (Gmail strips relative paths).
// CDN URL is build-time inlined; for emails we read it once here.
const CDN_URL = (process.env.NEXT_PUBLIC_CDN_URL || "").replace(/\/+$/, "");

export const BRAND = {
  // Colors chosen to survive Gmail Web / Gmail iOS / Apple Mail / Outlook
  // light-mode rendering. Dark-mode email clients auto-invert; these still
  // remain legible because text is dark on cream (high contrast both ways).
  cream: "#FAF6EE",
  parchment: "#F3ECD9",
  gold: "#C9A24A",
  goldDark: "#8E6F22",
  ink: "#1B1A17",
  muted: "#615C50",
  border: "#E4DCC4",
  // Logo: F.png is the canonical Fang mark per CLAUDE.md. If a wordmark
  // becomes available, swap LOGO_URL — slot consumers don't need to change.
  logoUrl: CDN_URL ? `${CDN_URL}/F.png` : `${SITE_URL}/F.png`,
  siteUrl: SITE_URL,
  supportEmail: SUPPORT_EMAIL,
};

// ─── Slot types ──────────────────────────────────────────────────────────
// Every Phase 1/2/3 template plugs into this shape. New slots are additive.
export type EmailSlots = {
  // Recipient identity
  userName?: string;          // Display name; falls back to "friend"
  userEmail?: string;         // For footer "sent to ___"
  // Action
  ctaUrl?: string;            // Primary button destination (absolute)
  ctaLabel?: string;          // Primary button label
  // Stats / context
  streakDays?: number;
  subjectName?: string;       // e.g. "AWS Sec Specialty"
  fangsEarned?: number;
  // Academia weekly digest
  itemCount?: number;         // # of dated items in the next-7-day window
  weekRangeLabel?: string;    // e.g. "Jun 10 to Jun 16"
  agendaHtml?: string;        // Pre-rendered day-grouped <table> rows (HTML-safe)
  agendaText?: string;        // Plain-text agenda for the text fallback
  prefsUrl?: string;          // Absolute manage-preferences URL (footer)
  // Triage (contact-form only)
  fromName?: string;
  fromEmail?: string;
  category?: string;
  subject?: string;
  messageHtml?: string;       // Already escaped + <br>-joined
  // Phase 2 hook — AI-generated paragraph (HTML-safe string)
  aiPersonalization?: string;
};

// ─── Slot interpolator ───────────────────────────────────────────────────
// Replaces `{{slot}}` with the slot value. Unknown slots in dev log a warning;
// in prod they render empty (graceful degradation > 500 on the API route).
function interpolate(template: string, slots: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key in slots && slots[key] !== undefined && slots[key] !== null) {
      return String(slots[key]);
    }
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[email-render] missing slot {{${key}}} — rendering empty`);
    }
    return "";
  });
}

// ─── Base layout ─────────────────────────────────────────────────────────
// Every template is wrapped in this. Header with logo + gold strip, content
// slot, footer with support + unsubscribe placeholder.
//
// Footer "unsubscribe" link is a mailto for now (Resend supports List-Unsubscribe
// headers — wire those when we expose user-level preferences). Sam's call.
function baseLayout({
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
<body style="margin:0;padding:0;background:${BRAND.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.ink};-webkit-font-smoothing:antialiased;">
<!-- Preheader (hidden) — shows as preview text in inbox lists -->
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
                <td align="right" valign="middle" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${BRAND.goldDark};letter-spacing:0.12em;text-transform:uppercase;">
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
          <td style="padding:36px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:${BRAND.ink};">
${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px;background:${BRAND.parchment};border-top:1px solid ${BRAND.border};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.muted};">
            <p style="margin:0 0 8px 0;color:${BRAND.muted};font-size:12px;">
              Questions? Reply to this email or hit
              <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.goldDark};text-decoration:underline;">${BRAND.supportEmail}</a>.
            </p>
            <p style="margin:0 0 8px 0;color:${BRAND.muted};font-size:12px;">
              <a href="${BRAND.siteUrl}" style="color:${BRAND.goldDark};text-decoration:underline;">getlionade.com</a>
              &nbsp;&middot;&nbsp;
              <a href="${BRAND.siteUrl}/settings" style="color:${BRAND.goldDark};text-decoration:underline;">Email preferences</a>
            </p>
            <p style="margin:0;color:${BRAND.muted};font-size:11px;opacity:0.8;">
              You're receiving this because you signed up at getlionade.com.
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

// ─── Renderer ────────────────────────────────────────────────────────────
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;     // Plain-text fallback (Resend includes this if provided)
};

export type TemplateDef = {
  /** Unique id — used by the dev preview route. */
  id: string;
  /** Default subject line (may contain slots). */
  subject: string;
  /** Preheader (inbox preview text) — may contain slots. */
  preheader: string;
  /** Body HTML (may contain slots). Wrapped in baseLayout at render time. */
  body: string;
  /** Plain-text fallback (may contain slots). */
  text: string;
};

export function renderEmail(template: TemplateDef, slots: EmailSlots = {}): RenderedEmail {
  // Merge defaults so slots always have safe values
  const withDefaults: Record<string, unknown> = {
    userName: "friend",
    ctaLabel: "Open Lionade",
    ctaUrl: BRAND.siteUrl,
    aiPersonalization: "",
    ...slots,
  };

  return {
    subject: interpolate(template.subject, withDefaults),
    html: baseLayout({
      preheader: interpolate(template.preheader, withDefaults),
      bodyHtml: interpolate(template.body, withDefaults),
    }),
    text: interpolate(template.text, withDefaults),
  };
}

// ─── Reusable CTA button ─────────────────────────────────────────────────
// Helper a template author can embed via raw string (kept simple — not exposed
// as a slot so authors stay in control of placement + spacing).
export function ctaButton(): string {
  // VML wrapper for Outlook desktop (bulletproof button pattern).
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
  <tr>
    <td align="center" style="border-radius:8px;background:${BRAND.goldDark};">
      <a href="{{ctaUrl}}"
         style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;background:${BRAND.goldDark};">
        {{ctaLabel}} &rarr;
      </a>
    </td>
  </tr>
</table>`;
}
