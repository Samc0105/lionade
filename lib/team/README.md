# Team Management and IAM

Web admin identity and access management for Lionade. Provision and offboard
`@getlionade.com` team identities, and optionally real Lionade accounts, from a
single admin console. Web only.

This module is the server-side core. The HTTP surface lives under
`app/api/admin/team/*` and the daily enforcement sweep at
`app/api/cron/team-mfa-enforce/route.ts`. Every privileged operation runs through
the service-role client and is gated, origin-checked, rate-limited, and audited.

---

## The problem

A small team accumulates identity sprawl fast: a mailbox here, a Supabase login
there, a shared Stripe password in a chat thread. Each surface is provisioned by
hand, none of it is audited, and offboarding becomes a checklist that someone
forgets a line of. The goal of this module is to make team identity a single
controlled action:

- Issue a `username@getlionade.com` forwarding mailbox.
- Optionally mint a real Lionade Supabase account with a one-time credential.
- Persist one authoritative `team_members` row that links the mailbox, the auth
  account, and the membership lifecycle.
- Tear all of it down atomically on offboard, with an immutable record of who did
  what.

One form in, one row of truth out, one audited path for every change.

---

## Architecture

### Provider-agnostic email abstraction

Team mailboxes are forwarding addresses, not full inboxes. The implementation is
hidden behind the `EmailProvider` interface in `email-provider.ts`:

```
createAddress(username, forwardTo) -> { addressId }
deleteAddress(addressId)
listAddresses() -> EmailAddress[]
updateForwardingDestination(addressId, newForwardTo)
```

- **Cloudflare Email Routing (today).** Free, no SDK, plain `fetch` against the
  documented REST API (`zones/{zone}/email/routing/rules`). Each team mailbox is
  one routing rule: a `literal` matcher on the `to` address and a `forward`
  action to the personal destination. The rule `tag` is persisted into
  `team_members.cloudflare_address_id` so we can revoke it later.
- **Google Workspace (stub).** `GoogleWorkspaceProvider` documents the migration
  path to real mailboxes via the Admin SDK Directory API. When it lands, a
  `TEAM_EMAIL_PROVIDER` switch selects it inside `getEmailProvider()`. The call
  sites do not change.

The factory `getEmailProvider()` validates configuration at call time and throws
a clear `not configured: set X` error when env is missing, so a route maps it to
a 503 instead of crashing.

### Service-role, server-side only

Every privileged operation uses `supabaseAdmin` from `@/lib/supabase-server`
(service role, `BYPASSRLS`). The anon client is never used for team operations.
None of this module is importable from a client bundle.

### RLS model

`team_members` has Row Level Security enabled (migration
`20260616121503_team_management.sql`):

- `team_members_admin_all`: an authenticated caller whose
  `current_app_role() = 'admin'` has full access.
- `team_members_self_select`: a member may `SELECT` only their own row
  (`auth.uid() = user_id`).
- `anon` is revoked entirely. The table is unreachable unauthenticated.

The API routes run as service role and so bypass RLS, but RLS is the backstop
for any direct client query: a non-admin authenticated session sees only its own
row, and the public never sees the table at all.

---

## Provisioning lifecycle

```
        provision
   (no row) --------> pending --------> active
                         |                |  \
                         |                |   \  suspend / mfa-autosuspend
                         |                |    \------------> suspended
                         |                |                      |
                         |                |   reactivate         |
                         |                +<---------------------+
                         |                |
                         +----------------+--- offboard ---> offboarded (terminal)
```

- **pending** is the provisioned state set by `POST /api/admin/team/provision`.
  The row, mailbox, and (if access was granted) auth account all exist; the
  member has not finished first sign-in.
- **active** is the working state.
- **suspended** is reversible. The Supabase auth account is banned (the ban is
  the security-critical action and the global session kill) and the row status
  flips. `reactivate` lifts the ban and restores `active`.
- **offboarded** is terminal. Reactivation is explicitly blocked; bring someone
  back by re-provisioning. The row is retained as the identity and audit record.

### The atomic rollback stack (provision)

Provisioning has multiple irreversible side effects across two systems
(Cloudflare and Supabase Auth) plus our own table. A half-provisioned state, a
Cloudflare rule with no row, or an auth user with no mailbox, is not acceptable.
The route in `app/api/admin/team/provision/route.ts` therefore treats every side
effect after the first as a step on an undo stack:

1. Pre-flight everything that can fail without a side effect: auth, origin, rate
   limit, body validation, env config, duplicate username/email, mailbox clash.
2. Create the Cloudflare forwarding rule. Push its delete onto `rollback`.
3. Mint the temporary password (CSPRNG, never logged or returned).
4. If access was granted, create the Supabase auth account. Push its delete onto
   `rollback`.
5. Insert the `team_members` row. Push its delete onto `rollback`.
6. Generate the one-time recovery link.
7. Render and send the welcome email.

On any failure from step 4 onward, `unwind()` runs the stack in reverse,
best-effort, logging but never throwing. On success the stack is cleared so a
later audit hiccup can never unwind completed work. The audit row is written last
and is non-fatal: if it fails the response carries `audit_log_failed: true`
rather than rolling back a real provision.

### Offboard

`POST /api/admin/team/offboard` is partial-failure-safe rather than
all-or-nothing, because once someone is leaving, locking them out should not be
blocked by a flaky mail send. The status flip to `offboarded` is the hard
precondition; everything after is an independently caught step recorded in a
per-step result (`true` / `false` / `"skipped"`):

- **soft (default):** ban the auth account (revokes sessions), re-point the
  Cloudflare rule at the admin fallback inbox so team mail keeps flowing, demote
  any `profiles` row to `former_team`, notify the member and Sam. The mailbox
  and row are retained.
- **hard:** all of soft, plus delete the Cloudflare rule outright so mail
  bounces. The Supabase user and the `team_members` row are deliberately kept.

A typed confirmation (the caller must echo the member's exact username) gates the
destructive path.

---

## Security controls

Each control maps to real code. This is the part that matters.

1. **Server-side role verification (`requireRole`).** Every `/api/admin/team/*`
   handler starts with:

   ```ts
   const staff = await requireRole(req, "admin");
   if (staff instanceof NextResponse) return staff;
   ```

   `requireRole` (in `@/lib/admin-auth`) authenticates the bearer token and reads
   `profiles.role` server-side, failing closed to `'user'`. Page-level gating in
   the admin layout is UX only. The client is never trusted for role or identity.

2. **Append-only audit (DB immutability trigger).** Every mutating action writes
   an `admin_audit_log` row via `writeTeamAudit`. The migration installs
   `trg_admin_audit_log_immutable`, which raises on any `DELETE` and on any
   `UPDATE` that changes `id`, `action`, `metadata`, or `created_at`. The only
   update it permits is the `ON DELETE SET NULL` FK cascade nulling
   `performed_by` / `target_user_id`, so GDPR profile deletion still works while
   the audit content stays immutable. Verbs: `team_provision`, `team_offboard`,
   `team_offboard_hard`, `team_role_change`, `team_password_reset`,
   `team_mfa_autosuspend`.

3. **Per-admin rate limiting (10/hr, fail-closed).** `assertProvisionRateLimit`
   counts each admin's `team_provision` audit rows over a trailing rolling 60
   minutes. There is no separate counter table: the mandatory audit log is the
   source of truth, so the count cannot drift from what actually happened. The
   window is computed from `now`, not a fixed clock bucket, so there is no
   burst-at-the-boundary loophole. If the count query fails, the limiter denies
   the action (fail-closed) rather than allowing an unbounded account-creation
   loop. Exceeding the cap returns 429 with `Retry-After`.

4. **CSPRNG temporary passwords, never logged or returned.** `generateTempPassword`
   in `password.ts` draws from `crypto.randomBytes` (the OS CSPRNG), never
   `Math.random` (seeded, reversible). It uses rejection sampling rather than
   modulo so every character is uniformly distributed, guarantees one of each
   complexity class, and Fisher-Yates shuffles so the guaranteed characters are
   not pinned to the front. The 20-character result is shown to the new colleague
   only in the welcome email body (the delivery channel by design). It is never
   logged, never placed in audit metadata, and never returned in the API response.

5. **Credential stripping in the audit writer.** `writeTeamAudit` deep-strips any
   key matching `password` / `passwd` / `pwd` / `secret` / `token` / `credential`
   (case-insensitive, substring, recursive into objects and arrays) and replaces
   the value with `[REDACTED]` before insert. This is a last-line guard: callers
   already avoid logging secrets, but the writer does not trust them. Because the
   log is immutable, a leaked secret could never be scrubbed afterward, so the
   only safe place to stop it is before the write.

6. **Trusted-origin defense in depth (`assertTrustedOrigin`).** Lionade
   authenticates exclusively via `Authorization: Bearer <jwt>` with no auth
   cookies, so classic CSRF (which exploits ambient cookie credentials the
   browser attaches automatically) is structurally not applicable: a forged
   cross-site request simply arrives unauthenticated and is rejected by
   `requireRole`. A CSRF token would be pure ceremony. The origin check is
   therefore defense in depth, not the primary control: it cheaply rejects any
   mutation whose `Origin` / `Referer` is not our own app, narrowing the blast
   radius of any future change that accidentally introduces cookie auth or a
   misconfigured CORS allowance. It fails closed: a mutation with neither header
   is rejected.

7. **7-day MFA-or-suspend enforcement (cron).** Every privileged member (role in
   `founder` / `engineer` / `support` with non-`none` Lionade access) must enroll
   a verified TOTP factor within 7 days of activation (or invite, if never
   separately activated). The daily sweep at
   `app/api/cron/team-mfa-enforce/route.ts` finds active, privileged, linked
   accounts past the grace window with no verified TOTP factor, bans the auth
   account, flips the row to `suspended`, and audits `team_mfa_autosuspend`. A
   cron rather than a sign-in gate is deliberate: a dormant privileged account
   would otherwise sit past its window forever. The sweep fails open on missing
   timestamps or a transient MFA-read error (it skips rather than risk a wrongful
   lockout) and is idempotent (only `active` rows are candidates).

8. **Least privilege.** `lionade_access` defaults to `none`: a team member gets a
   forwarding mailbox without any product account unless access is explicitly
   granted. Roles are a closed CHECK-constrained set. RLS limits a member to
   their own row. The MFA enforcement set is scoped to genuinely privileged
   roles, not every row.

Additional hardening worth noting: error responses are generic and never echo a
raw Supabase or provider message (which can reflect attacker-tunable input such
as "email already registered"); the username pre-check rejects a reserved/system
name list before the DB unique constraint; and the suspend/offboard/cron paths
ban the auth account first (the security-critical step) before touching the row,
so a later DB failure still leaves the account locked out.

---

## Threat model

| Attacker capability | What they get | Why it is blunted |
| --- | --- | --- |
| Stolen non-admin bearer token | Nothing on these routes | `requireRole(req, "admin")` reads the role server-side and fails closed; a `user`/`support` token gets 403. |
| Cross-site page trying to drive a mutation | Nothing | No cookie auth, so the request is unauthenticated and `requireRole` rejects it; `assertTrustedOrigin` rejects it again as defense in depth, failing closed on a missing Origin. |
| Compromised admin session attempting bulk provisioning | At most 10 accounts/hour | `assertProvisionRateLimit` caps each admin per rolling hour and fails closed if it cannot verify the count, bounding an automated account-creation loop. |
| Read access to logs or error bodies | No credential material | Temp passwords, recovery links, and decrypted values are never logged, never in audit metadata, never in error bodies; the audit writer redacts credential-like keys defensively. |
| Read access to `admin_audit_log` | The history, but cannot alter it | The immutability trigger blocks DELETE and content UPDATE, so the record of who provisioned/offboarded/revealed cannot be rewritten to cover tracks. |
| A dormant privileged account that never enabled MFA | Locked out after 7 days | The daily cron bans and suspends it deterministically and audits the action. |
| Direct DB access as a non-admin authenticated user | Only their own `team_members` row | RLS `team_members_self_select` restricts non-admins to `auth.uid() = user_id`; `anon` is revoked. |

The residual gaps are documented under "What I would add next."

---

## Setup

This feature is fully env-gated. With nothing configured, the routes return clear
503s (`not configured: set X`); they never crash at import time, because every
`process.env` read happens inside a function at call time.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token. Scope: **Zone > Email Routing > Edit** on `getlionade.com`. Never logged; sent only in the `Authorization` header. |
| `CLOUDFLARE_ZONE_ID` | The zone id for `getlionade.com`. |
| `CLOUDFLARE_EMAIL_ROUTING_DOMAIN` | `getlionade.com`. The domain mailboxes are issued under. |
| `RESEND_API_KEY` | Reused from the existing transactional email setup. Sends the welcome / reset / offboard notices. |
| `EMAIL_FROM` | Reused. The verified sender address. |
| `ADMIN_FORWARD_EMAIL` | Optional. Fallback inbox a soft-offboarded mailbox re-points to, and where offboard heads-ups go. Defaults to `support@getlionade.com`. |
| `NEXT_PUBLIC_SITE_URL` | Optional. The trusted origin for `assertTrustedOrigin`. Defaults to `https://getlionade.com`; localhost dev origins are allowed only when `NODE_ENV !== "production"`. |
| `CRON_SECRET` | Bearer secret Vercel sends to the MFA cron. Compared in constant time; the route fails closed (500) if unset. |

A missing email provider config or `RESEND_API_KEY`/`EMAIL_FROM` is detected in
the provision pre-flight and returns a 503 before any side effect, so a
provisioning run can never get stuck halfway because mail was never configured.

### Running the migration

The migration is written for manual application by Sam. It is never auto-applied.

```
lib/migrations/20260616121503_team_management.sql
```

Run it once against the Supabase project. It creates `team_members`, its indexes
and `updated_at` trigger, the RLS policies, the `admin_audit_log` immutability
trigger, and adds `former_team` to the `profiles.role` CHECK. It depends on
`public.profiles`, `public.admin_audit_log`, and `public.current_app_role()`
already existing.

### Cron schedule

`vercel.json` schedules the MFA sweep daily:

```json
{ "path": "/api/cron/team-mfa-enforce", "schedule": "0 8 * * *" }
```

08:00 UTC daily. Vercel authenticates the request with
`Authorization: Bearer $CRON_SECRET` (header only; the secret never lands in a
query string or access log).

---

## What I would add next

- **Hardware keys / WebAuthn.** Today MFA enforcement checks for a verified TOTP
  factor. WebAuthn / passkeys would raise the assurance level for the most
  privileged roles and resist phishing in a way TOTP does not.
- **Reservation-based rate limiting.** The current limiter counts completed
  `team_provision` audit rows, which leaves a small time-of-check to
  time-of-use window under concurrent requests from one admin. A reservation
  (insert-a-pending-row-then-confirm, or an atomic counter) would close it.
- **SCIM.** A SCIM endpoint would let an external identity provider drive
  provisioning and deprovisioning, replacing the manual console for orgs that
  already run an IdP and making lifecycle changes flow from one source of truth.
