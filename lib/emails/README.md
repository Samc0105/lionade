# `lib/emails` — Lionade transactional email program

**Phase 1 deliverable (2026-05-25).** Shared template skeleton + 5 production
templates + 3 Supabase Auth reference HTMLs. No external email framework
(no `@react-email`, no `mjml`) — plain HTML strings + a typed slot interpolator
per Sam's directive ("logo + light polish, not a framework rewrite").

---

## Surface

```ts
import { renderEmail, templates } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";

const { subject, html, text } = renderEmail(templates.welcome, {
  userName: profile.display_name,
  ctaUrl: absoluteUrl("/dashboard"),
  ctaLabel: "Open Lionade",
});

await resend.emails.send({ from, to, subject, html, text });
```

---

## Templates

| Key | File | When | Trigger status |
|-----|------|------|----------------|
| `waitlistConfirmation` | `templates/waitlist-confirmation.ts` | User joins waitlist | ✅ Wired (`app/api/waitlist/route.ts`) |
| `contactForm` | `templates/contact-form.ts` | User submits contact form | ✅ Wired (`app/api/contact/route.ts`) |
| `welcome` | `templates/welcome.ts` | Right after Supabase signup-verify | ✅ Wired Phase 1.5 (`app/api/auth/welcome/route.ts`) — Supabase Auth webhook, server-to-server. Idempotent via `profiles.welcome_email_sent_at` (migration 048). Requires `SUPABASE_AUTH_HOOK_SECRET` env var. Paste step: `lib/emails/supabase/README.md` §2. |
| `firstStreakDay` | `templates/first-streak-day.ts` | User hits day-1 streak for the first time | ✅ Wired (`app/api/save-quiz-results/route.ts`) |
| `masteryStart` | `templates/mastery-start.ts` | User creates first-ever Mastery session | ✅ Wired (`app/api/mastery/exams/[id]/sessions/route.ts`) |

---

## Slot reference

Every template renders with the same `EmailSlots` shape (additive — new slots
are safe; missing slots fall back to defaults or render empty). Defined in
`render.ts`.

| Slot | Type | Used by | Notes |
|------|------|---------|-------|
| `userName` | string | most | Defaults to `"friend"` |
| `userEmail` | string | (reserved) | For future personalization |
| `ctaUrl` | string | most | Defaults to `SITE_URL` |
| `ctaLabel` | string | most | Defaults to `"Open Lionade"` |
| `streakDays` | number | `firstStreakDay` | |
| `fangsEarned` | number | `firstStreakDay` | |
| `subjectName` | string | `masteryStart` | E.g. `"AWS Sec Specialty"` |
| `fromName` | string | `contactForm` | Sender name (escaped at API layer) |
| `fromEmail` | string | `contactForm` | Sender email |
| `category` | string | `contactForm` | Whitelisted category |
| `subject` | string | `contactForm` | User-submitted subject |
| `messageHtml` | string | `contactForm` | **Must be pre-escaped** — see anti-injection note |
| `aiPersonalization` | string | **Phase 2 hook** | AI-generated paragraph; all body templates have a slot for it |

### Anti-injection note

`{{messageHtml}}` is the ONLY slot expected to contain HTML. Every API route
that fills it MUST run user input through HTML-escape first. See
`app/api/contact/route.ts` for the canonical `escapeHtml(...).replace(/\n/g, "<br />")`
pattern. All other slots are plain text — the renderer does NOT escape them
because templates control where they land, and they are not user-controlled
in the wired call sites today (server-derived `display_name`, server-known
`subjectName`, etc.).

If a future template needs to accept user-controlled text in a non-`messageHtml`
slot, escape at the call site.

---

## Phase 2 hooks (where AI personalization plugs in)

Every body template has a `{{aiPersonalization}}` slot between the CTA button
and the closing paragraph. When Phase 2 lands, the send-trigger call site can:

```ts
const personalization = await ninnyGeneratePersonalization({
  template: "welcome",
  userId,
  profileSnapshot: { streak, subjectInterests, recentActivity },
});

renderEmail(templates.welcome, {
  userName: profile.display_name,
  ctaUrl: absoluteUrl("/dashboard"),
  ctaLabel: "Open Lionade",
  aiPersonalization: `<p style="margin:18px 0 0 0;font-size:15px;line-height:1.65;color:#1B1A17;">${personalization}</p>`,
});
```

The slot defaults to `""` so unwired call sites render normally.

---

## Email-client compatibility

Targets: Gmail Web, Gmail iOS, Apple Mail (macOS + iOS), Outlook Web.

Decisions made for survival:
- **Tables for layout** (Outlook 2007–2019 don't reliably render `<div>` flex).
- **Inline styles only** — Gmail strips `<style>` tags.
- **System font stack** — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`. No web fonts (would fall back unstylishly in Outlook).
- **Light cream/parchment background, gold accents, dark text** — survives dark-mode auto-invert in Gmail/Outlook because contrast remains high in both directions.
- **PNG logo only** (SVG is stripped by some clients).
- **600px max-width centered table** — the universal "safe width."
- **Preheader** (hidden div) — sets the inbox-preview text per template.

---

## Local dev preview

Dev-only route at `app/dev/emails/page.tsx` renders every template inline.
Gated on `NODE_ENV !== 'production'` — never ships.

Visit `http://localhost:3000/dev/emails` while running `npm run dev`.

---

## Supabase Auth templates

`supabase/` contains three HTML files matching the lib/emails skeleton style.
**They are NOT applied programmatically.** Sam pastes them into the Supabase
dashboard. See `supabase/README.md` for paste instructions.

---

## Adding a new template (Phase 3 playbook)

1. Create `templates/<name>.ts` exporting a `TemplateDef`.
2. Register in `index.ts` under `templates`.
3. Add a row to the table above + trigger-status column.
4. Add a tile to `app/dev/emails/page.tsx`.
5. Wire the send in the appropriate API route. Always `await renderEmail(...)` +
   `await resend.emails.send(...)` AFTER the primary DB write succeeds — email
   send failure must NOT 500 the API.
