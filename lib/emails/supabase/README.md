# Supabase Auth email templates — paste instructions

**These templates are NOT applied automatically.** Supabase Auth email templates
live in the Supabase dashboard, not in this repo. Paste each HTML file into the
matching template slot.

---

## Where to paste

1. Open the Supabase dashboard for project `dbfsuefyplbzhxysrrav`.
2. Go to **Authentication → Email Templates**.
3. For each template below, switch to **HTML** source mode and replace the
   entire body with the contents of the matching file.

| File | Dashboard slot | Subject line to set |
|------|---------------|---------------------|
| `signup-verify.html` | **Confirm signup** | `confirm your lionade email` |
| `password-reset.html` | **Reset Password** | `reset your lionade password` |
| `magic-link.html` | **Magic Link** | `your lionade sign-in link` |

The other slots (Invite, Email Change, Reauthentication) are not touched in
Phase 1 — they retain Supabase defaults until they become user-facing.

---

## Variables to verify

Each template uses Supabase Go-template variables. After pasting, eyeball
that these appear exactly as shown (Supabase will not warn on a typo):

- `{{ .ConfirmationURL }}` — the action link (verify / reset / magic sign-in)
- `{{ .Email }}` — the recipient's email
- `{{ .SiteURL }}` — only if referenced (we don't reference it; it's set on
  the project settings page)
- `{{ .Token }}` — 6-digit OTP, not used here (we use magic links). If you
  ever want OTP-style verification, that variable is available.

Spaces inside the braces matter — `{{.Email}}` (no spaces) will NOT interpolate.

---

## After pasting — manual QA

1. In the dashboard, click **"Send test email"** at the bottom of each
   template editor. Send to a real inbox you control.
2. Verify in Gmail Web AND Gmail iOS:
   - Logo loads (CDN: `d1745aj99cclbu.cloudfront.net`)
   - Button is tappable + the gold color renders
   - Footer "support@getlionade.com" link works
   - No raw `{{ .ConfirmationURL }}` text visible (means a variable typo)
3. If something looks off in dark-mode Gmail, the cream/parchment palette
   inverts to dark-gold/dark-cream which is intended — text stays readable
   because the contrast was designed both ways.

---

## Reverting

If a paste goes sideways, the Supabase dashboard has a **"Reset to default"**
button on every template editor. The files in this directory are the source
of truth for the Lionade-branded versions — re-paste from here.

---

## Future enhancement (Phase 3+)

Supabase **does** support `email_templates` updates via the
[Management API](https://api.supabase.com/api/v1#tag/v1-config/PATCH/v1/projects/%7Bref%7D/config/auth)
but the Supabase MCP server we use here does NOT expose that endpoint as a
tool today. When/if it does, this README's "paste manually" step can become
an `ops-deployment` automation.
