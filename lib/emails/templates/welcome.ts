/**
 * Welcome email — sent immediately after Supabase signup-verify completes.
 *
 * Phase 1 deliverable 3.1 (template) + Phase 1.5 (wiring).
 *
 * Send-trigger WIRED in app/api/auth/welcome/route.ts as a Supabase Auth
 * webhook (server-to-server, post-verify). Idempotent via
 * profiles.welcome_email_sent_at (migration 048) — replay-safe under
 * Supabase retries. Requires SUPABASE_AUTH_HOOK_SECRET env var + a one-time
 * dashboard paste of the webhook URL; see lib/emails/supabase/README.md.
 *
 * Voice: Ninny. Job: bridge from Supabase's bland verify email → "here are
 * the 3 things to do first." Keep CTA single — the body explains the 3 paths
 * but the button goes to /dashboard.
 */
import { TemplateDef, ctaButton } from "../render";

export const welcome: TemplateDef = {
  id: "welcome",
  subject: "welcome to lionade, {{userName}}.",
  preheader: "Your account's live. Here's where to start.",
  body: `
<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:#1B1A17;">
  you're in. for real this time. 🦷
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  What's good {{userName}}. Account's verified, Lionade's yours.
  Quick rundown so you're not just staring at a dashboard:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px 0;">
  <tr>
    <td style="padding:14px 16px;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;font-size:15px;line-height:1.6;color:#1B1A17;">
      <strong style="color:#8E6F22;">1. Take a quiz.</strong> Pick any subject. 10 questions. You earn <strong>Fangs</strong> for every right answer.
    </td>
  </tr>
  <tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr>
    <td style="padding:14px 16px;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;font-size:15px;line-height:1.6;color:#1B1A17;">
      <strong style="color:#8E6F22;">2. Start a streak.</strong> Show up tomorrow. The longer you grind, the bigger the bonus.
    </td>
  </tr>
  <tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr>
    <td style="padding:14px 16px;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;font-size:15px;line-height:1.6;color:#1B1A17;">
      <strong style="color:#8E6F22;">3. Try Mastery.</strong> Pick an exam (AP, AWS, whatever) and Ninny builds you a study plan.
    </td>
  </tr>
</table>
<p style="margin:0 0 4px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  TL;DR: study, earn Fangs, cash out. That's the loop.
</p>
${ctaButton()}
{{aiPersonalization}}
<p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:#615C50;">
  Stuck? Just reply to this email. It goes straight to us.
</p>`,
  text: `welcome to lionade, {{userName}}.

What's good. Account's verified, Lionade's yours. Quick rundown:

1. Take a quiz. Pick any subject. 10 questions. You earn Fangs for every right answer.
2. Start a streak. Show up tomorrow. The longer you grind, the bigger the bonus.
3. Try Mastery. Pick an exam and Ninny builds you a study plan.

TL;DR: study, earn Fangs, cash out. That's the loop.

{{ctaLabel}}: {{ctaUrl}}

Stuck? Just reply to this email. It goes straight to us.

Lionade · getlionade.com
`,
};
