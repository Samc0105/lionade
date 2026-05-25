/**
 * Welcome email — sent immediately after Supabase signup-verify completes.
 *
 * Phase 1 deliverable 3.1. Template only. Send-trigger DEFERRED to Phase 1.5
 * because the repo has no app/api/auth/callback/route.ts — Supabase signup
 * flow is currently 100% client-side. Wiring this requires either:
 *  (a) A Supabase Auth webhook → new API route → enqueue email, OR
 *  (b) A client-side fetch on the post-verify success screen.
 *
 * (a) is the right answer (server-side, can't be skipped). Filed for Phase 1.5.
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
  What's good {{userName}} — account's verified, Lionade's yours.
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
  Stuck? Just reply to this email — it goes straight to us.
</p>`,
  text: `welcome to lionade, {{userName}}.

What's good — account's verified, Lionade's yours. Quick rundown:

1. Take a quiz. Pick any subject. 10 questions. You earn Fangs for every right answer.
2. Start a streak. Show up tomorrow. The longer you grind, the bigger the bonus.
3. Try Mastery. Pick an exam and Ninny builds you a study plan.

TL;DR: study, earn Fangs, cash out. That's the loop.

{{ctaLabel}}: {{ctaUrl}}

Stuck? Just reply to this email — it goes straight to us.

— Lionade · getlionade.com
`,
};
