# Shared Credential Vault

Web admin feature that lets admins store and share team secrets, third-party
logins, API tokens, and infra passwords, without dropping them into a chat
message or a spreadsheet. Each secret is sealed at rest with authenticated
encryption under a key that lives only in the server environment. Web only.

The server-side core is `crypto.ts` (sealing) and `types.ts` (the non-secret
projection). The HTTP surface is `app/api/admin/vault/*`.

---

## Purpose

A team needs a handful of shared logins: the Stripe dashboard, a social account,
an infra credential. They tend to live wherever they were last pasted. The vault
gives them one admin-only home where:

- The secret is encrypted before it ever touches the database.
- Display metadata (label, username, url, notes) stays in plaintext so admins can
  find and identify a credential without decrypting it.
- Every reveal of a plaintext secret is recorded in an immutable audit log.

---

## Crypto design

`crypto.ts` implements `encryptSecret` / `decryptSecret` with **AES-256-GCM**:

- **Key:** 32 bytes (256 bit), base64-encoded, read from
  `CREDENTIAL_ENCRYPTION_KEY`. The key is held **only** in the server
  environment, never in the database.
- **IV:** a fresh **12-byte** random IV per call (`randomBytes(12)`), the
  GCM-recommended size. It is never reused with the same key.
- **Auth tag:** the 16-byte GCM authentication tag, fetched only after
  `cipher.final()`, stored alongside the ciphertext.
- **Storage:** ciphertext, IV, and tag are each base64 across three columns
  (`secret_ciphertext`, `secret_iv`, `secret_auth_tag`). The IV and tag are not
  secret; only the key is.

GCM is authenticated encryption. On decrypt, `setAuthTag` is applied before
`final()`, and `final()` throws if the ciphertext, IV, or tag was tampered with
or the wrong key is used. The decrypt path therefore fails loudly rather than
returning garbage or partial plaintext, and no plaintext is ever returned on a
tag failure. The reveal route catches that throw, logs a detail-free line, and
returns a single generic error; the underlying crypto error is never echoed.

The env key is read and validated at call time inside `readKey()`, never at
module load, so importing this file can never crash a route. A missing or
malformed key (anything that does not base64-decode to exactly 32 bytes)
surfaces only when an encrypt or decrypt is attempted, and `isVaultConfigured()`
lets the routes pre-check and return a clean 503 instead. Errors name the
variable and may state the decoded byte length (length is not sensitive); they
never include the key bytes.

---

## The key threat-model point

The whole point of the design is what a database compromise yields. The database
stores only ciphertext, a per-row random IV, and the GCM auth tag. The key is not
in the database.

So a full DB compromise, a leaked dump, a stolen backup, a SQL injection that
reads every row, even a malicious admin reading rows directly through RLS, yields
nothing but ciphertext. Without the environment key, none of it decrypts.
Decryption is possible exclusively inside a running server process that holds the
key. Pulling the database does not pull the secrets.

---

## Encrypted vs plaintext

| Field | Storage | Why |
| --- | --- | --- |
| The secret | **Encrypted** (`secret_ciphertext` + `secret_iv` + `secret_auth_tag`) | This is the protected material. It only ever appears as plaintext in the reveal response body. |
| `label` | Plaintext | Human-readable name, required. Shown in the list. |
| `username` | Plaintext | The login email/handle, for display and search. Not the secret. |
| `url` | Plaintext | Where the credential is used. |
| `category`, `notes` | Plaintext | Grouping and free-text notes. The secret must never go here. |

The `VaultItem` type and `VAULT_NON_SECRET_COLUMNS` constant in `types.ts`
deliberately omit the three secret columns. The list, create, and update routes
select and return only the non-secret projection, so a sealed secret cannot leave
the server through them by accident. The plaintext secret leaves the server in
exactly one place: the response of `POST /api/admin/vault/[id]/reveal`.

---

## Audit trail

Every vault mutation and every reveal writes an `admin_audit_log` row via
`writeTeamAudit`:

- `vault_create` (id + label)
- `vault_update` (id + the list of field **names** changed, never values; a
  rotated secret is recorded only as the name `secret`)
- `vault_delete` (id + label)
- `vault_reveal` (id + label)

The reveal is audited **before** the secret is returned, so the immutable log is
the permanent who-saw-what record even if the response is dropped in transit. The
audit metadata never carries a decrypted secret, and `writeTeamAudit` deep-strips
credential-like keys as a last-line guard regardless.

The log is append-only: the `trg_admin_audit_log_immutable` trigger (installed by
the team-management migration, which this feature depends on) blocks any DELETE
and any content UPDATE, so a reveal record cannot be erased or rewritten.

---

## Access control

`shared_credentials` has RLS enabled with a single admin-only policy
(`shared_credentials_admin_all`, gated on `current_app_role() = 'admin'` for all
operations). `anon` is revoked entirely. The `/api/admin/vault/*` routes run as
the service-role client (`supabaseAdmin`, `BYPASSRLS`) and start with
`requireRole(req, "admin")`; every mutation also runs `assertTrustedOrigin` as
defense in depth before any write. Even an admin reading rows directly through
RLS gets only ciphertext, because the key is not in the database.

---

## Setup

This feature is env-gated. With no key configured, the create / update-with-new-
secret / reveal paths return a clean 503 (`Credential vault not configured: set
CREDENTIAL_ENCRYPTION_KEY`); they never crash at import time.

1. **Generate a key** (32 random bytes, base64):

   ```
   openssl rand -base64 32
   ```

2. **Set `CREDENTIAL_ENCRYPTION_KEY`** in Vercel for Production and Preview. It is
   server-side crypto: it must never be a `NEXT_PUBLIC_*` variable and must never
   ship in any client bundle.

3. **Run the migration manually** (it is never auto-applied):

   ```
   lib/migrations/20260616130000_shared_credentials.sql
   ```

   It creates `shared_credentials`, its indexes and `updated_at` trigger, and the
   admin-only RLS policy. It depends on `public.profiles`,
   `public.current_app_role()`, and the `admin_audit_log` immutability trigger
   from the team-management migration already existing.

---

## Key rotation

Rotating `CREDENTIAL_ENCRYPTION_KEY` is a two-phase, zero-downtime operation. It
is wired end to end: a decrypt fallback in `crypto.ts` and an admin-only re-seal
route. You never have to take reveals offline to rotate.

**How it works in the code:**

- `decryptSecretFlexible` (in `crypto.ts`) tries the **active** key
  (`CREDENTIAL_ENCRYPTION_KEY`) first. If that GCM check throws and a valid
  **previous** key (`CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`) is configured, it
  retries with the previous key. So while both vars are live, every reveal keeps
  working regardless of which key a given row is still sealed under.
- `encryptSecret` always uses the **active** key only. New writes never touch the
  previous key, so anything created or re-sealed during the window is already on
  the new key.
- `POST /api/admin/vault/rotate` (admin only) walks every `shared_credentials`
  row, decrypts it with `decryptSecretFlexible` (active first, previous as
  fallback), and re-encrypts it with the active key. It is **per-row safe**: a
  single unopenable or un-writable row is collected into `failedIds` and the loop
  continues. It is **re-runnable / idempotent**: an already-rotated row simply
  decrypts under the active key and is re-sealed under the same key, so re-running
  retries only the rows that previously failed. The route refuses with a 400 when
  `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` is unset, because there would be nothing to
  rotate from. The rotation is audited as `vault_rotate` with `{ total, rotated,
  failed_ids }` only. The response returns 200 when every row re-sealed, 207 when
  some `failedIds` remain. Decrypted plaintext never leaves the server, never gets
  logged, and never appears in the audit metadata or the response.

**Operator runbook:**

1. **Generate a new key:**

   ```
   openssl rand -base64 32
   ```

2. **Stage both keys in Vercel (Production AND Preview):**
   - Move the existing `CREDENTIAL_ENCRYPTION_KEY` value into a new var
     `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`.
   - Set `CREDENTIAL_ENCRYPTION_KEY` to the freshly generated key.
   - Redeploy so both vars are live in the running server. Reveals keep working
     throughout because of the previous-key fallback.

3. **Run the rotation** from `/admin/vault` (the button that calls
   `POST /api/admin/vault/rotate`). Confirm the result re-sealed every row. If any
   `failedIds` come back, run it again; the re-run only retries those rows.

4. **Retire the old key:** once the rotation reports zero `failedIds`, remove
   `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` from Vercel (Production AND Preview) and
   redeploy. The old key is now out of the environment and every row is sealed
   under the new key.

**Honest limits:**

- Both vars are plain Vercel env values; this is not KMS-backed envelope
  encryption, so during the window the prior key lives in the environment until
  you remove it in step 4. The previous-key value is held to the same secrecy bar
  as the active key (never logged, never echoed).
- Per-row rotation of a single secret is still available outside this flow via
  `PATCH /api/admin/vault/[id]` with a new `secret`, which re-seals that one row
  under the active key.

---

## Onboarding gate

Provisioned team members are forced through onboarding before they can use the
product, which is what makes the 7-day MFA-enforcement cron safe to run.

`POST /api/admin/team/provision` sets two flags on the new account's auth
`user_metadata`: `must_change_password` and (for the enforced-MFA role set:
founder / engineer / support) `mfa_required`. `TeamGate` (mounted globally in
`app/layout.tsx`) reads those flags and redirects:

1. `must_change_password === true` routes to `/onboard/password`.
2. `mfa_required === true` with no verified TOTP factor routes to `/onboard/mfa`.

`TeamGate` reads both flags straight off `user_metadata`, so it is zero-network
for normal (non-staff) users, and only an `mfa_required` account ever calls
`mfa.listFactors()`. Exempt paths (`/onboard/*`, `/reset-password`, `/login`,
`/signup`, `/logout`) are never redirected, so the onboarding destinations are
self-exempt and there are no redirect loops.

Because provisioning forces a privileged member into TOTP enrollment up front,
the `GET /api/cron/team-mfa-enforce` daily sweep is a backstop rather than a
surprise. It only acts on members past a 7-day grace window (`GRACE_DAYS = 7`,
measured from `activated_at`, falling back to `invited_at`) who still have no
verified TOTP factor, and then bans the auth account and flips the membership to
`suspended`, audited as `team_mfa_autosuspend`. A compliant or dormant member who
already enrolled simply passes the check.

**Honest limit:** `TeamGate` is a client-side redirect, not a server-side
authorization gate. It nudges staff into onboarding but is not the security
boundary on its own. The actual enforcement is the cron (which bans accounts that
miss the grace window) plus the per-route `requireRole` checks. `TeamGate` also
fails open on a `listFactors` read fault, deferring to the cron as the backstop.

---

## Current limitations

- **Single key, no envelope encryption.** The at-rest key is a single env value
  (plus an optional second one during a rotation window), not a per-secret data
  key wrapped by a KMS master key. Key rotation is supported (see above), but a
  KMS-backed envelope scheme would add per-secret keys, automated rotation, and an
  external audit of key use.
- **Reveal is the trust boundary.** Any admin can reveal any secret; the control
  is that the reveal is audited, not that it is restricted per credential. There
  is no per-credential ACL or approval step.
