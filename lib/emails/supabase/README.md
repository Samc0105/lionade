# Supabase Auth — paste instructions (Phase 1 + 1.5)

**These templates and webhook URLs are NOT applied automatically.** Supabase
Auth lives in the Supabase dashboard, not in this repo. Sam pastes each item
into the matching dashboard slot.

There are now **two kinds** of dashboard items to paste:

1. **3 Auth email templates** (HTML — signup-verify, password-reset, magic-link)
2. **1 Auth webhook URL** (post-verify welcome email — added Phase 1.5)

---

## 1) Auth email templates (HTML paste)

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
Phase 1/1.5 — they retain Supabase defaults until they become user-facing.

### Variables to verify in the templates

Each template uses Supabase Go-template variables. After pasting, eyeball
that these appear exactly as shown (Supabase will not warn on a typo):

- `{{ .ConfirmationURL }}` — the action link (verify / reset / magic sign-in)
- `{{ .Email }}` — the recipient's email
- `{{ .SiteURL }}` — only if referenced (we don't reference it; it's set on
  the project settings page)
- `{{ .Token }}` — 6-digit OTP, not used here (we use magic links). If you
  ever want OTP-style verification, that variable is available.

Spaces inside the braces matter — `{{.Email}}` (no spaces) will NOT interpolate.

### Test sends after pasting

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

## 2) Auth webhook URL — welcome email (Phase 1.5)

Sam pastes this so Lionade's `welcome` email fires server-to-server right
after the user verifies signup. Replaces the deferred Phase 1 approach.

### One-time env-var

On Vercel (Production + Preview):

```
SUPABASE_AUTH_HOOK_SECRET = <a long random string — generate with: openssl rand -base64 48>
```

This is the bearer token the webhook route validates against. Do NOT commit
the value. Without it set, the route 401s every payload (failure-closed).

### Dashboard configuration

1. Supabase dashboard → Project Settings → **Authentication → Hooks** (some
   dashboards label it **Auth Hooks** or **Webhooks**).
2. Add a hook for the **email-verified** event (sometimes labeled "After User
   Signs Up" or "Send Email"). The exact label varies by Supabase version;
   the event we want is the post-verify success event.
3. Configure:
   - **URL:** `https://getlionade.com/api/auth/welcome`
   - **HTTP method:** `POST`
   - **Headers:** `Authorization: Bearer <SAME value as SUPABASE_AUTH_HOOK_SECRET>`
4. Save.

### Test the webhook end-to-end

1. Create a brand-new test account at `https://getlionade.com/login` using a
   throwaway email.
2. Verify the email via the link in the Supabase-rendered "Confirm signup"
   message.
3. Within seconds, the welcome email should arrive in the same inbox.
4. Sanity-check `profiles.welcome_email_sent_at` in the Supabase SQL editor:
   `select id, welcome_email_sent_at from profiles where id = '<the new user id>';`
   should show a non-null timestamp.

### What if the secret is wrong / missing?

The route returns 401 on every payload. Supabase will retry with backoff.
Once Sam pastes the secret correctly, the next retry succeeds and the welcome
email lands.

### What if Resend fails on the first attempt?

The route returns 500 (without stamping the `welcome_email_sent_at` column).
Supabase retries; the idempotency check (the column) keeps the next attempt
from double-sending if the first one secretly succeeded.

---

## Reverting

If a template paste goes sideways, the Supabase dashboard has a
**"Reset to default"** button on every template editor. The files in this
directory are the source of truth for the Lionade-branded versions — re-paste
from here.

If the welcome webhook misfires, delete the hook from the dashboard. The
template + route stay in the repo for next time.

---

## Future enhancement (Phase 3+)

Supabase **does** support `email_templates` updates via the
[Management API](https://api.supabase.com/api/v1#tag/v1-config/PATCH/v1/projects/%7Bref%7D/config/auth)
but the Supabase MCP server we use here does NOT expose that endpoint as a
tool today. When/if it does, this README's "paste manually" step can become
an `ops-deployment` automation.
