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

Rotating `CREDENTIAL_ENCRYPTION_KEY` is the honest limitation today. There is no
built-in rotation. Because every row is sealed under the current key, swapping the
env var alone would make every existing secret fail to decrypt (GCM would throw
on the wrong key).

The migration path is decrypt-with-old, re-encrypt-with-new: hold both keys
transiently, walk every `shared_credentials` row, `decryptSecret` with the old
key and `encryptSecret` with the new one, write the new ciphertext/IV/tag, then
retire the old key. This is flagged as future work. Per-row rotation of an
individual secret is already supported today through `PATCH
/api/admin/vault/[id]` with a new `secret`, which re-seals that one row under the
current key.

---

## Current limitations

- **No key rotation tooling** (see above). A full key change requires a one-off
  re-encryption pass that does not yet exist.
- **Single key, no envelope encryption.** The key is a single env value, not a
  per-secret data key wrapped by a KMS master key. A KMS-backed envelope scheme
  would add per-secret keys, managed rotation, and an external audit of key use.
- **Reveal is the trust boundary.** Any admin can reveal any secret; the control
  is that the reveal is audited, not that it is restricted per credential. There
  is no per-credential ACL or approval step.
