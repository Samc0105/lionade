/**
 * Dev-only email preview route — never ships to prod.
 *
 * Renders every template in lib/emails so we can eyeball them in a browser
 * without burning Resend quota. Gated on NODE_ENV !== "production" (returns
 * notFound() in prod, which makes the route literally unreachable).
 *
 * Usage: `npm run dev` then visit `http://localhost:3000/dev/emails`.
 * Click a template to view its rendered HTML in an isolated iframe.
 */
import { notFound } from "next/navigation";
import { renderEmail, templates, type TemplateKey, type EmailSlots } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";

// Per-template sample slots so the preview shows realistic content.
const SAMPLES: Record<TemplateKey, EmailSlots> = {
  waitlistConfirmation: {
    userName: "Sam",
    ctaUrl: absoluteUrl("/"),
    ctaLabel: "Visit Lionade",
  },
  contactForm: {
    fromName: "Jordan Lee",
    fromEmail: "jordan@example.com",
    category: "Bug Report",
    subject: "Quiz timer freezes at question 7",
    messageHtml:
      "Hey — running Chrome 124 on macOS.<br />The timer pauses when I switch tabs.<br />Repro: take any AP Bio quiz, alt-tab away, come back.<br /><br />Thanks!",
  },
  welcome: {
    userName: "Sam",
    ctaUrl: absoluteUrl("/dashboard"),
    ctaLabel: "Open dashboard",
  },
  firstStreakDay: {
    userName: "Sam",
    fangsEarned: 45,
    ctaUrl: absoluteUrl("/dashboard"),
    ctaLabel: "Keep the streak alive",
  },
  streakReminder: {
    userName: "Sam",
    streakDays: 12,
    ctaUrl: absoluteUrl("/quiz"),
    ctaLabel: "Save my streak",
    prefsUrl: absoluteUrl("/settings"),
  },
  masteryStart: {
    userName: "Sam",
    subjectName: "AWS Sec Specialty",
    ctaUrl: absoluteUrl("/learn/mastery/example-id"),
    ctaLabel: "Open Mastery",
  },
  academiaWeekly: {
    userName: "Sam",
    itemCount: 3,
    weekRangeLabel: "Jun 10 to Jun 16",
    agendaHtml: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px 0;">
  <tr><td style="font-size:14px;font-weight:700;color:#1B1A17;padding:0 0 8px 2px;">Tuesday, Jun 11</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px 0;">
  <tr>
    <td style="padding:10px 14px;background:#FAF6EE;border:1px solid #E4DCC4;border-radius:8px;font-size:15px;line-height:1.5;color:#1B1A17;">
      <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#8E6F22;margin-right:8px;">Exam</span>
      <strong>Unit 4 Test</strong>
      <span style="color:#615C50;font-size:13px;"> &middot; AP Biology</span>
    </td>
  </tr>
  <tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>`,
    agendaText: "Tuesday, Jun 11\n  - Exam: Unit 4 Test (AP Biology)",
    ctaUrl: absoluteUrl("/academia"),
    ctaLabel: "Open your planner",
    prefsUrl: absoluteUrl("/settings"),
  },
};

export default function EmailPreviewIndex({
  searchParams,
}: {
  searchParams?: { template?: string };
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const requested = searchParams?.template as TemplateKey | undefined;
  if (requested && requested in templates) {
    const tpl = templates[requested];
    const rendered = renderEmail(tpl, SAMPLES[requested]);
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "20px", background: "#0a0a0a", color: "#eee", minHeight: "100vh" }}>
        <a href="/dev/emails" style={{ color: "#C9A24A", textDecoration: "underline" }}>← Back to all templates</a>
        <h1 style={{ marginTop: "12px" }}>{tpl.id}</h1>
        <p style={{ color: "#aaa" }}>
          <strong>Subject:</strong> {rendered.subject}
        </p>
        <details style={{ marginBottom: "12px", background: "#1a1a1a", padding: "12px", borderRadius: "8px" }}>
          <summary style={{ cursor: "pointer", color: "#aaa" }}>Plain-text fallback</summary>
          <pre style={{ whiteSpace: "pre-wrap", color: "#ccc", fontSize: "13px", margin: "12px 0 0 0" }}>{rendered.text}</pre>
        </details>
        <iframe
          srcDoc={rendered.html}
          style={{ width: "100%", height: "1200px", border: "1px solid #333", borderRadius: "8px", background: "white" }}
        />
      </div>
    );
  }

  // Index — list every template with a thumbnail link
  const all = Object.keys(templates) as TemplateKey[];
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "20px", background: "#0a0a0a", color: "#eee", minHeight: "100vh" }}>
      <h1>Email previews <span style={{ color: "#C9A24A" }}>(dev only)</span></h1>
      <p style={{ color: "#aaa" }}>
        Phase 1 templates. NODE_ENV: <code>{process.env.NODE_ENV}</code>
      </p>
      <ul style={{ listStyle: "none", padding: 0, marginTop: "24px" }}>
        {all.map(key => {
          const rendered = renderEmail(templates[key], SAMPLES[key]);
          return (
            <li key={key} style={{ padding: "16px", marginBottom: "12px", background: "#1a1a1a", borderRadius: "8px" }}>
              <a href={`/dev/emails?template=${key}`} style={{ color: "#C9A24A", fontSize: "18px", fontWeight: 600, textDecoration: "none" }}>
                {key}
              </a>
              <div style={{ color: "#aaa", fontSize: "14px", marginTop: "4px" }}>
                Subject: {rendered.subject}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
