/**
 * Academia weekly digest — "Your week ahead."
 *
 * Sent every Monday ~8am ET by the Vercel cron at
 * app/api/cron/academia-digest/route.ts to users who have the
 * `notifications.weekly_report` toggle ON (default true). Lists the user's
 * dated Academia items over the next 7 days: exam target dates (user_exams)
 * + assignment due dates (class_assignments), grouped by day, each annotated
 * with its class name.
 *
 * The cron SKIPS users with zero items in the window, so this template always
 * renders a non-empty agenda. The day-grouped HTML is built server-side in the
 * cron route and injected via the `agendaHtml` slot (the renderer's
 * `{{slot}}` interpolator can't loop, so the list is pre-rendered).
 *
 * Voice: Ninny-adjacent, calm. Job: a quick glance at what's coming, one tap
 * to the planner. NO em-dashes anywhere (hyphens in compounds are fine).
 *
 * Phase 2 hook: `{{aiPersonalization}}` is reserved for an AI-written nudge
 * paragraph (e.g. "Your Bio exam is your biggest gap this week"). Empty for V1.
 */
import { TemplateDef, ctaButton } from "../render";

// Slot contract (consumed via EmailSlots, with these extras passed through):
//   userName       → greeting name (falls back to "friend")
//   itemCount      → number of items in the window (for the subject + heading)
//   weekRangeLabel → human label like "Jun 10 to Jun 16"
//   agendaHtml     → pre-rendered, day-grouped <table> rows (built in the cron)
//   ctaUrl         → absolute /academia URL
//   ctaLabel       → "Open your planner"
//   prefsUrl       → absolute /settings URL for the footer manage link
//   aiPersonalization → optional Phase 2 paragraph (HTML-safe)

export const academiaWeekly: TemplateDef = {
  id: "academia-weekly",
  subject: "your week ahead: {{itemCount}} on the calendar.",
  preheader: "Exams and due dates coming up over the next 7 days.",
  body: `
<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:#1B1A17;">
  your week ahead. 📅
</h1>
<p style="margin:0 0 8px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  Morning {{userName}}. Here's what's on your Academia calendar for
  <strong>{{weekRangeLabel}}</strong>. Nothing sneaks up on you this week.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 6px 0;">
  <tr>
    <td style="font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#8E6F22;padding:0 0 10px 0;">
      Your week ahead
    </td>
  </tr>
</table>
{{agendaHtml}}
${ctaButton()}
{{aiPersonalization}}
<p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:#615C50;">
  Add anything you're missing right in the planner. Future you says thanks.
</p>
<p style="margin:14px 0 0 0;font-size:12px;line-height:1.6;color:#615C50;">
  You get this because Weekly Report is on.
  <a href="{{prefsUrl}}" style="color:#8E6F22;text-decoration:underline;">Manage email preferences</a>.
</p>`,
  text: `your week ahead: {{itemCount}} on the calendar.

Morning {{userName}}. Here's what's on your Academia calendar for {{weekRangeLabel}}:

{{agendaText}}

{{ctaLabel}}: {{ctaUrl}}

Add anything you're missing right in the planner.

You get this because Weekly Report is on. Manage email preferences: {{prefsUrl}}

Lionade · getlionade.com
`,
};
