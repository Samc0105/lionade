/**
 * Streak-at-risk reminder — "your N-day streak is about to lapse."
 *
 * Sent by the daily Vercel cron at app/api/cron/streak-reminder/route.ts to
 * users whose streak is ALIVE but about to break: their last quiz was 24-44h
 * ago, so a quiz TODAY still ticks the streak (the increment window is 20-48h
 * since last activity — see save-quiz-results), but if they let it pass 48h the
 * streak resets. The cron gates on the EMAIL toggle
 * `notifications_email.streak_alert` (default ON) and a per-session idempotency
 * marker (`profiles.streak_reminder_sent_at`), so a given streak-session only
 * ever triggers ONE reminder.
 *
 * Voice: Ninny. Job: one tap back in before the clock runs out. Urgent but not
 * panicky — they still have hours, not minutes. NO em-dashes (hyphens in
 * compounds are fine).
 *
 * Slot contract:
 *   userName   → greeting name (falls back to "friend")
 *   streakDays → the current at-risk streak length (subject + body)
 *   ctaUrl     → absolute /quiz URL ("knock out one quiz")
 *   ctaLabel   → "Save my streak"
 *   prefsUrl   → absolute /settings URL for the footer manage link
 *   aiPersonalization → optional Phase 2 paragraph (HTML-safe)
 */
import { TemplateDef, ctaButton } from "../render";

export const streakReminder: TemplateDef = {
  id: "streak-reminder",
  subject: "your {{streakDays}}-day streak is on the line.",
  preheader: "One quiz today keeps it alive. Miss it and it resets to zero.",
  body: `
<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:#1B1A17;">
  don't drop the streak. 🔥
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  Hey {{userName}}. Your <strong>{{streakDays}}-day streak</strong> is hanging by a thread.
  One quiz today and it keeps climbing. Skip today and it's back to day zero.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px 0;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;">
  <tr>
    <td style="padding:18px 20px;font-size:15px;line-height:1.65;color:#1B1A17;">
      <strong style="color:#8E6F22;">The math:</strong> one quiz takes a couple minutes.
      Rebuilding {{streakDays}} days from scratch takes {{streakDays}} days.
      <br/><br/>
      Knock out a single quiz before the day's over and you're safe.
    </td>
  </tr>
</table>
${ctaButton()}
{{aiPersonalization}}
<p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:#615C50;">
  Already studied today? You're good, ignore this. The clock just hadn't caught up when we hit send.
</p>
<p style="margin:14px 0 0 0;font-size:12px;line-height:1.6;color:#615C50;">
  You get this because Streak Alerts are on.
  <a href="{{prefsUrl}}" style="color:#8E6F22;text-decoration:underline;">Manage email preferences</a>.
</p>`,
  text: `your {{streakDays}}-day streak is on the line.

Hey {{userName}}. Your {{streakDays}}-day streak is hanging by a thread. One quiz today and it keeps climbing. Skip today and it's back to day zero.

The math: one quiz takes a couple minutes. Rebuilding {{streakDays}} days from scratch takes {{streakDays}} days.

{{ctaLabel}}: {{ctaUrl}}

Already studied today? You're good, ignore this.

You get this because Streak Alerts are on. Manage email preferences: {{prefsUrl}}

Lionade · getlionade.com
`,
};
