/**
 * First-day-streak congrats — sent when a user transitions from streak=0
 * (or no streak) to streak=1 for the first time ever.
 *
 * Phase 1 deliverable 3.2. Send-trigger WIRED in
 * app/api/save-quiz-results/route.ts at the streak-update block (around line
 * 259, where `newStreak = 1` after first quiz). Gated on
 * `previousStreakWasZeroOrNull && newStreak === 1 && !emailSentBefore`.
 *
 * Voice: Ninny. Job: hook for return tomorrow. Don't oversell — they did one
 * quiz, not finished an AP.
 */
import { TemplateDef, ctaButton } from "../render";

export const firstStreakDay: TemplateDef = {
  id: "first-streak-day",
  subject: "day 1. you're cooking.",
  preheader: "Streak started. Come back tomorrow to keep it.",
  body: `
<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:#1B1A17;">
  day 1 streak. 🔥
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  Lookatchu {{userName}} — first quiz down, streak started, <strong>{{fangsEarned}} Fangs</strong> in the bag.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px 0;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;">
  <tr>
    <td style="padding:18px 20px;font-size:15px;line-height:1.65;color:#1B1A17;">
      <strong style="color:#8E6F22;">Here's the play:</strong> show up tomorrow, hit one more quiz, and your streak jumps to day 2.
      <br/><br/>
      Hit <strong>day 3</strong>, you bank a <strong>50-Fang milestone bonus</strong>.
      Day 7? <strong>150 Fangs.</strong>
      Day 14? <strong>500.</strong>
      Stack 'em.
    </td>
  </tr>
</table>
${ctaButton()}
{{aiPersonalization}}
<p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:#615C50;">
  Don't break the chain. We'll see you tomorrow.
</p>`,
  text: `day 1. you're cooking.

Lookatchu — first quiz down, streak started, {{fangsEarned}} Fangs in the bag.

Here's the play: show up tomorrow, hit one more quiz, and your streak jumps to day 2.

Milestone bonuses:
- Day 3 → 50 Fangs
- Day 7 → 150 Fangs
- Day 14 → 500 Fangs

Stack 'em.

{{ctaLabel}}: {{ctaUrl}}

— Lionade · getlionade.com
`,
};
