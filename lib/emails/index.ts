/**
 * Public surface for lib/emails.
 *
 * Usage from an API route:
 *   import { renderEmail, templates } from "@/lib/emails";
 *   const { subject, html, text } = renderEmail(templates.welcome, {
 *     userName: "Sam",
 *     ctaUrl: absoluteUrl("/dashboard"),
 *     ctaLabel: "Open dashboard",
 *   });
 *   await resend.emails.send({ from, to, subject, html, text });
 */
export { renderEmail, BRAND, ctaButton } from "./render";
export type { EmailSlots, RenderedEmail, TemplateDef } from "./render";

import { waitlistConfirmation } from "./templates/waitlist-confirmation";
import { contactForm } from "./templates/contact-form";
import { welcome } from "./templates/welcome";
import { firstStreakDay } from "./templates/first-streak-day";
import { masteryStart } from "./templates/mastery-start";

export const templates = {
  waitlistConfirmation,
  contactForm,
  welcome,
  firstStreakDay,
  masteryStart,
} as const;

export type TemplateKey = keyof typeof templates;
