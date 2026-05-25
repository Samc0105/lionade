/**
 * Mastery-start congrats — sent when a user creates their FIRST-EVER Mastery
 * exam session.
 *
 * Phase 1 deliverable 3.3. Send-trigger WIRED in
 * app/api/mastery/exams/[id]/sessions/route.ts (POST). Gated on
 * "first mastery_sessions row for this user" — i.e. before the new session
 * insert, we count() existing sessions for the user; if 0, this is their
 * first, send the email.
 *
 * Voice: Ninny. Job: confirm setup + set cadence expectation. Don't prescribe
 * a study plan — Ninny does that in-app.
 */
import { TemplateDef, ctaButton } from "../render";

export const masteryStart: TemplateDef = {
  id: "mastery-start",
  subject: "mastery: {{subjectName}} — locked in.",
  preheader: "Your exam's set up. Here's how Mastery works.",
  body: `
<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:#1B1A17;">
  mastery on. 🎯
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  Bet, {{userName}}. You just started Mastery for <strong>{{subjectName}}</strong>.
  Ninny's already sizing up the topics.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px 0;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;">
  <tr>
    <td style="padding:18px 20px;font-size:15px;line-height:1.65;color:#1B1A17;">
      <strong style="color:#8E6F22;">How Mastery works:</strong>
      <br/><br/>
      &middot;&nbsp; Each topic has its own progress bar (0&rarr;100%).<br/>
      &middot;&nbsp; You answer questions, Ninny adapts difficulty in real time.<br/>
      &middot;&nbsp; Get a topic to 80%? It's mastered. Bar locks in.<br/>
      &middot;&nbsp; Daily reps &gt; cram sessions. 15 min/day will eat your exam alive.
    </td>
  </tr>
</table>
<p style="margin:0 0 4px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  Open the exam, start where Ninny suggests, and just let it cook.
</p>
${ctaButton()}
{{aiPersonalization}}
<p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:#615C50;">
  You got this. Talk to Ninny in-app if you're stuck on a topic.
</p>`,
  text: `mastery: {{subjectName}} — locked in.

Bet, {{userName}}. You just started Mastery for {{subjectName}}. Ninny's already sizing up the topics.

How Mastery works:
- Each topic has its own progress bar (0→100%).
- You answer questions, Ninny adapts difficulty in real time.
- Get a topic to 80%? It's mastered. Bar locks in.
- Daily reps > cram sessions. 15 min/day will eat your exam alive.

Open the exam, start where Ninny suggests, and just let it cook.

{{ctaLabel}}: {{ctaUrl}}

— Lionade · getlionade.com
`,
};
