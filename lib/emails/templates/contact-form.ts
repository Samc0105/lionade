/**
 * Contact-form notification — sent TO support@getlionade.com (Sam), NOT to
 * the form-submitter. Job: 5-second triage.
 *
 * Phase 1 deliverable 2.B. Subject embeds category + sender + first ~40
 * chars of the message so the inbox preview is enough to triage.
 *
 * Voice: not Ninny — this is an internal triage email. Plain, scannable.
 */
import { TemplateDef } from "../render";

export const contactForm: TemplateDef = {
  id: "contact-form",
  // {{subject}} here is the user-submitted subject line, already escaped.
  subject: "[{{category}}] {{subject}} — {{fromEmail}}",
  preheader: "{{fromName}} ({{fromEmail}}) sent a contact-form message.",
  body: `
<p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#615C50;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">
  Contact form &middot; {{category}}
</p>
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#1B1A17;">
  {{subject}}
</h1>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;">
  <tr>
    <td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#1B1A17;">
      <strong style="color:#615C50;">From:</strong> {{fromName}}<br/>
      <strong style="color:#615C50;">Email:</strong> <a href="mailto:{{fromEmail}}" style="color:#8E6F22;text-decoration:underline;">{{fromEmail}}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#615C50;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">
  Message
</p>
<div style="margin:0;padding:16px;background:#FFFFFF;border:1px solid #E4DCC4;border-radius:8px;font-size:15px;line-height:1.65;color:#1B1A17;white-space:pre-wrap;">
{{messageHtml}}
</div>
<p style="margin:20px 0 0 0;font-size:13px;line-height:1.5;color:#615C50;">
  Reply directly to this email to respond — the reply-to is set to the sender.
</p>`,
  text: `[{{category}}] {{subject}}

From: {{fromName}} <{{fromEmail}}>

Message:
{{messageHtml}}

— Reply directly to respond.
`,
};
