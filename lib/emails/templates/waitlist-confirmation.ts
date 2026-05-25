/**
 * Waitlist confirmation — sent to a user who just joined the waitlist.
 *
 * Phase 1 deliverable 2.A. Replaces the inline dark-theme template that was
 * in app/api/waitlist/route.ts.
 *
 * Voice: Ninny (Gen Z, warm, hyped, low-key). Avoids corporate "thank you for
 * your interest." CTA leads to share-for-priority since waitlist user can't
 * actually enter the app yet.
 */
import { TemplateDef, ctaButton } from "../render";

export const waitlistConfirmation: TemplateDef = {
  id: "waitlist-confirmation",
  subject: "you're in.",
  preheader: "You made the list. Here's what happens next.",
  body: `
<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;font-weight:700;color:#1B1A17;">
  you're in. 🦷
</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  Heyyy {{userName}}. You officially made the Lionade waitlist. Welcome to the den.
</p>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  Lionade is the study-rewards platform where grinding actually pays off.
  Take quizzes, build streaks, earn <strong>Fangs</strong>, cash them out.
  That's it. That's the app.
</p>
<p style="margin:0 0 12px 0;font-size:16px;line-height:1.65;color:#1B1A17;">
  <strong>What happens next:</strong>
</p>
<ul style="margin:0 0 22px 0;padding:0 0 0 20px;font-size:15px;line-height:1.7;color:#1B1A17;">
  <li style="margin-bottom:6px;">We'll ping you the moment your spot opens.</li>
  <li style="margin-bottom:6px;">Early access folks get a <strong>bonus Fang drop</strong> on day one.</li>
  <li style="margin-bottom:0;">No spam. Just the good stuff.</li>
</ul>
${ctaButton()}
{{aiPersonalization}}
<p style="margin:24px 0 0 0;font-size:14px;line-height:1.6;color:#615C50;">
  Want priority? Share Lionade with a friend who studies. It moves you up the list.
</p>`,
  text: `you're in.

Heyyy {{userName}}. You officially made the Lionade waitlist. Welcome to the den.

Lionade is the study-rewards platform where grinding actually pays off. Take quizzes, build streaks, earn Fangs, cash them out.

What happens next:
- We'll ping you the moment your spot opens.
- Early access folks get a bonus Fang drop on day one.
- No spam. Just the good stuff.

{{ctaLabel}}: {{ctaUrl}}

Want priority? Share Lionade with a friend who studies. It moves you up the list.

Lionade · getlionade.com
`,
};
