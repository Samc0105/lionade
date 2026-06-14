# Spec: note-images → S3 presigned-upload pilot

**Status:** Draft for review · **Date:** 2026-06-14 · **Owner:** admin (web/infra) + vp-ios (upload path)
**Why this exists:** a deliberate, bounded hands-on-S3 exercise that also sets `note-images` up as the landing zone for future AWS-native processing (Textract, Rekognition). NOT a product necessity — Supabase Storage already does this job.

---

## 0. Review hardening (adversarial pass, 2026-06-14)

This spec was pressure-tested by `security-auth-guardian` + `business-legal-compliance` before build. The findings below are now folded into the sections that follow; this is the at-a-glance summary so nothing is lost at build time.

**Security (folded into §4–§7):**
- **Ownership check is equality, not `startsWith`.** Split the key on `/`, assert `parts[0]` is the bucket prefix and `parts[1] === userId` by EQUALITY, and reject any key containing `..`, `//`, or control chars (strict regex `^user-uploads/<uuid>/<uuid>\.(jpg|png|webp)$`). `startsWith("user-uploads/" + userId + "/")` is vulnerable to prefix-confusion + traversal. **This check is the security boundary, not the select-own table.**
- **One key prefix, no remap.** Store S3 objects under the SAME prefix as the token (`user-uploads/{uid}/...`) so there is no `user-uploads/`→`note-images/` rewrite. Removes a cross-backend naming trap (legacy Supabase is `note-images/`, S3 is `user-uploads/` — never the same string).
- **Both resolver branches enforce caller===owner**, and the legacy Supabase branch MUST sign with the RLS/anon client, NEVER `supabaseAdmin`. The token lives in user-editable `class_notes.body`, so a user can write either prefix; don't leave the Supabase branch as the soft target.
- **Split IAM into two principals:** request-path = `PutObject`+`GetObject` only (no List, no Delete); cron-purge = `ListBucket`+`DeleteObject`. One shared user is not the least-privilege the spec claims.
- **Presigned POST uses a literal `Key`** (never a `starts-with`/`$key` condition), pins `content-length-range` + content-type, and stores with `Content-Disposition: attachment` so the object is never rendered same-origin.

**Compliance (folded into §8 + new §8.5):**
- **🔴 BLOCKER — purge before cascade, fail-closed.** The reaper's `auth.admin.deleteUser` cascade destroys the `class_notes` rows. Run the object purges BEFORE the cascade; if a purge throws, `continue` (skip the cascade) so the row stays scheduled and retries. Never let the Postgres delete proceed on a failed object purge, or PII is orphaned with no pointer.
- **🔴 BLOCKER — erasure must cover BOTH object stores.** Dual-read means a migrated user has photos in Supabase Storage AND S3. The reaper must purge all three in order: Supabase Storage `note-images` → S3 `lionade-user-uploads` → Postgres cascade. **Verify whether account deletion purges Supabase Storage today — it probably does NOT (a likely pre-existing erasure leak the pilot must surface and fix).**
- **Versioned-bucket tail.** `DeleteObject` on a versioned bucket only writes a delete marker; bytes persist as noncurrent for ~30 days. Either delete by `VersionId` (immediate erasure) or document the ≤30-day tail as inside the policy's "within 30 days" promise.
- **Privacy Policy + AUP edits required** (drafted in §8.5): name AWS/S3 as a subprocessor, disclose photo storage, add a retention line, add a "don't upload other people without permission" AUP line.

---

## 1. Goal & scope

Move **only** the `note-images` binary blobs (class-note photos) from Supabase Storage to a private AWS S3 bucket, using the classic **presigned-upload** pattern (the client never holds AWS credentials). Keep everything else (syllabus PDFs, avatars, the text in Postgres) exactly where it is.

**In scope**
- A new **private** S3 bucket for user uploads (Terraform-managed).
- A server-minted **presigned POST** so iOS uploads bytes straight to S3.
- A server-minted **presigned GET** so the web/iOS read layer resolves a short-lived view URL.
- The **authorization model** that replaces Supabase RLS (ownership enforced at the presign step).
- The **account-deletion (GDPR) purge hook**.
- A **dual-read migration** so existing Supabase photos keep working with zero backfill.

**Non-goals (explicit)**
- No CloudFront in the pilot (phase 2 — it cuts egress + adds caching).
- No backfill of existing Supabase objects (they stay on Supabase, read path unchanged).
- No move of syllabus PDFs, avatars, or any Postgres text.
- No Vercel→AWS OIDC yet (pilot uses a scoped IAM user; OIDC is the roadmap follow-up that kills the static keys).

---

## 2. Current state (Supabase Storage)

- **Bucket:** `note-images`, private, 10 MB limit, mimes `image/jpeg|png|webp|heic`.
- **Object key:** `<userId>/<uuid>.jpg` (owner-folder).
- **Reference:** embedded in `class_notes.body` (Postgres) as a markdown token: `![photo](note-images/<userId>/<uuid>.jpg)`.
- **Write:** iOS only (`expo-image-picker` → `supabase.storage.from('note-images').upload(...)`; owner-folder RLS authorizes via the user JWT). Web never writes — `lib/note-images.ts` is the **read/parse** layer.
- **Read:** `getSignedNoteImageUrl(objectKey)` → `supabase.storage.createSignedUrl(key, 3600)`, cached in-memory (`lib/note-images.ts`).
- **RLS:** owner-folder SELECT/INSERT/DELETE/UPDATE on `storage.objects` (migration `20260611_note_images_storage.sql`): `(storage.foldername(name))[1] = auth.uid()`.

**Key consequence:** because the upload path is iOS, this pilot is **cross-platform** — web/infra ships the bucket + presign APIs + read resolver + delete hook; iOS swaps its upload call. Web can ship its half independently and safely (nothing writes to S3 until iOS calls the new API).

---

## 3. Target architecture

```
                         ┌──────────────────────────────────────────┐
   iOS upload            │  Next.js API (holds scoped AWS creds)     │
  ┌────────────┐  1.POST │  POST /api/note-images/presign           │
  │ pick photo │ ───────▶│   requireAuth → key = note-images/{uid}/  │
  └────────────┘         │   {uuid}.{ext} → createPresignedPost()    │
        │                └──────────────────────────────────────────┘
        │ 2. PUT bytes (presigned POST, direct)         │ returns {url, fields, token}
        ▼                                               ▼
   ┌─────────────────────────┐                  token = "user-uploads/{uid}/{uuid}.{ext}"
   │  S3  lionade-user-uploads │  ◀── bytes never touch our server
   │  (private, BPA on, SSE)   │
   └─────────────────────────┘                 3. iOS writes token into class_notes.body
        ▲
        │ presigned GET (short TTL)
        │
   ┌──────────────────────────────────────────┐
   │  GET /api/note-images/sign-read?key=...   │  requireAuth → verify key prefix == {uid}
   │   → s3 getSignedUrl(GetObjectCommand,300) │  → return view URL (web + iOS render)
   └──────────────────────────────────────────┘
```

The bucket is **private with Block Public Access fully on**, so the *only* way in or out is a presigned URL our server mints **after an ownership check**. That check is the RLS-equivalent.

---

## 4. Upload flow (presigned POST)

`POST /api/note-images/presign`
1. `requireAuth(req)` → `userId` from the JWT (never from the body).
2. Validate body `{ contentType }` ∈ `{image/jpeg, image/png, image/webp}` (reject heic at upload — see §10), derive `ext`.
3. `objectKey = "user-uploads/" + userId + "/" + crypto.randomUUID() + "." + ext`. **The S3 key equals the token (no remap, see §0 + §5).** Pass this as a **literal `Key`** to `createPresignedPost` — never a `["starts-with", "$key", ...]` condition, which would let the client choose the final segment (classic prefix-escape).
4. `createPresignedPost(s3, { Bucket, Key: objectKey, Conditions: [["content-length-range", 1, 10_485_760], ["eq", "$Content-Type", contentType], ["eq", "$Content-Disposition", "attachment"]], Expires: 300 })`.
   - **Presigned POST (not PUT)** because POST can enforce a **max size** and content-type in the policy. A presigned PUT cannot cap size — a client could push a 5 GB object.
   - **`Content-Disposition: attachment`** so the object is never rendered as an inline same-origin document. The `$Content-Type` eq-condition does not inspect bytes (a client could POST an SVG/HTML payload tagged `image/png`); disposition + only-ever-served-via-short-presigned-GET neutralizes it. Treat the extension as a label, not a guarantee.
5. Return `{ url, fields, token: objectKey }`.

iOS then POSTs the multipart form (fields + file) straight to S3, and writes `![photo](<token>)` into `class_notes.body`. **Bytes never transit our server.**

---

## 5. Read flow (dual-backend resolver)

Rewrite `getSignedNoteImageUrl(objectKey)` in `lib/note-images.ts` to route by prefix, keeping the existing in-memory TTL cache. **Cache key = the full prefixed token (which embeds the userId), never a bare/normalized S3 key**, so a cached URL can never cross the prefix boundary.

**Both branches enforce caller === key-owner before signing** (the token lives in user-editable `class_notes.body`, so neither backend may be the soft target):

- Token `note-images/<uid>/...` (legacy Supabase) → assert the owner segment === caller, then `supabase.storage.createSignedUrl(...)`. **MUST use the RLS/anon `@/lib/supabase` client (which re-checks owner-folder RLS at sign time), NEVER `supabaseAdmin`** — the admin client would turn this branch into a cross-user read oracle since it bypasses RLS.
- Token `user-uploads/<uid>/...` (new S3) → `GET /api/note-images/sign-read?key=<key>`:
  1. `requireAuth` → `userId`.
  2. **Ownership check by EQUALITY, not `startsWith`:** validate `key` against the strict regex `^user-uploads/<uuid>/<uuid>\.(jpg|png|webp)$`, then split on `/` and assert `parts[1] === userId`. Reject any key with `..`, `//`, or control chars. This equality check IS the security boundary (not the select-own table, which is only incidental).
  3. `getSignedUrl(s3, GetObjectCommand{Bucket, Key: key}, {expiresIn: 300})` — **no remap**; the S3 key equals the token (§4.3).
  4. Return `{ url }`.

Extend `TOKEN_RE` in `lib/note-images.ts` to match both `note-images/` and `user-uploads/` prefixes so `parseNoteBody` / `stripNoteImageTokens` handle both. (iOS `lib/note-images.ts` mirror gets the same change.)

---

## 6. Authorization model (the RLS replacement)

| Concern | Supabase today | S3 pilot |
|---|---|---|
| Who can write where | RLS owner-folder INSERT | Presign API sets the `{userId}` prefix from the JWT; client cannot forge it |
| Max size / type | bucket config | presigned POST policy conditions (size + content-type) |
| Who can read | RLS owner-folder SELECT + signed URL | Bucket BPA on → no public read; sign-read API verifies `key` prefix == caller before signing |
| Cross-user access | impossible (RLS) | impossible (prefix check + private bucket) |
| Credential exposure | user JWT only | server holds scoped IAM creds; client never sees them |

---

## 7. Infrastructure (Terraform)

Mirror the existing `terraform/main.tf` `staging_assets` pattern. New resources (prod + staging):

- `aws_s3_bucket "user_uploads"` — `lionade-user-uploads` (+ `-staging`).
- `aws_s3_bucket_public_access_block` — all four flags `true` (private).
- `aws_s3_bucket_server_side_encryption_configuration` — SSE-S3 `AES256`.
- `aws_s3_bucket_versioning` — `Enabled` (recovery; matches house pattern). Add a lifecycle rule to expire **noncurrent** versions after ~30 days so versioning doesn't grow unbounded.
- `aws_s3_bucket_cors_configuration` — `AllowedMethods ["POST","GET"]`, `AllowedHeaders ["*"]`, `ExposeHeaders ["ETag"]`. **Prod `AllowedOrigins = ["https://getlionade.com"]` ONLY; the `localhost` origins go on the `-staging` bucket only** (CORS doesn't authorize, but keeping prod origins tight is free).
- `aws_s3_bucket_lifecycle_configuration` — `abort_incomplete_multipart_upload` after 1 day; expire **noncurrent** versions after ~30 days (see §8 for the erasure interaction).
- **Two IAM principals (real least-privilege, not one shared user):**
  ```
  # request-path user — keys live in Vercel env, serve presign routes
  lionade-user-uploads-web :  s3:PutObject, s3:GetObject   on arn:aws:s3:::lionade-user-uploads/*
                              (NO ListBucket, NO DeleteObject)
  # cron-purge user — keys used only by the reaper route
  lionade-user-uploads-reaper : s3:ListBucket              on arn:aws:s3:::lionade-user-uploads
                                s3:DeleteObject, s3:ListBucketVersions, s3:DeleteObjectVersion
                                                           on arn:aws:s3:::lionade-user-uploads(/*)
  ```
  Rationale: a leaked request-path key (the one in env, most exposed) then **cannot list every user's keys or delete anything** — it can only put/get its own server-chosen keys. No `*` actions, no other bucket. Tag everything `Project=Lionade, Environment, ManagedBy=Terraform`.

**Credentials → Vercel env:** `AWS_REGION=us-east-1`, `USER_UPLOADS_BUCKET`, the request-path key pair (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), and the reaper key pair under distinct names (`UPLOADS_REAPER_ACCESS_KEY_ID`/`_SECRET`). ⚠️ Both are **long-lived keys** — acceptable for a pilot, but the roadmap's **Vercel→AWS OIDC** item should replace them so no static AWS key lives in env. Track that as the security follow-up.

**SDK (server-only):** `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`.

---

## 8. Account deletion / GDPR hook

The reaper (`app/api/cron/reap-pending-deletions/route.ts`) currently does one thing: `auth.admin.deleteUser(row.id)`, which **cascades and destroys `class_notes`** (the only record of which photos exist). Two erasure stores now exist (dual-read), so erasure becomes a **multi-store transaction** that must be ordered and fail-closed.

**🔴 Required order, per user, each fail-closed:**
1. Purge **Supabase Storage** `note-images/<uid>/` AND `class-syllabi/<uid>/` (list owner-folder → `storage.remove([...])`). **VERIFIED 2026-06-14: deletion did NOT purge Supabase Storage** — `deleteUser` cascades Postgres FKs only, and a grep confirmed there was no `storage.remove()` anywhere in the codebase. This was a live (latent) pre-existing erasure leak, **now fixed** by `purgeUserSupabaseStorage` in `lib/storage-purge.ts`, wired into the reaper. Prod had 0 orphaned objects at verification time (no uploader had deleted yet), so nothing was actually exposed — fixed before it could trigger.
2. Purge **S3** `lionade-user-uploads`: `deleteUserNoteImagesFromS3(userId)` lists `Prefix: "user-uploads/" + userId + "/"` (the SAME prefix as the key + token, §4.3) and deletes. **Versioned bucket:** a plain `DeleteObject` only writes a delete marker (bytes persist as noncurrent ≤30 days). For true erasure, list `ListObjectVersions` under the prefix and `DeleteObject` each `VersionId` — OR accept the ≤30-day noncurrent tail as inside the policy's "within 30 days" promise and write that choice down here. (Pilot default: accept the tail; document it.)
3. **Only then** `auth.admin.deleteUser(row.id)` (the Postgres cascade).

**Fail-closed contract:** if step 1 or 2 throws, `continue` to the next user WITHOUT running step 3, so the row stays past `pending_deletion_at` and retries next run. The existing "one failed user must not abort the sweep" try/catch already gives this; the new rule is **never run the cascade on a failed object purge** (else PII is orphaned with no pointer).

- Per-photo delete on token removal from a note is **phase 2** storage hygiene. Until it ships, the Privacy Policy/AUP copy (§8.5) must not claim deleting a note removes the photo — it doesn't yet.

## 8.5 Compliance edits (required before/with the pilot)

Owner: `business-legal-compliance` drafts, `dev-frontend` ships the policy edits. None need a real lawyer for the pilot; fold into the existing "lawyer-reviewed before broader launch" pass the policy already promises.

- **Name AWS as a subprocessor.** `app/privacy/page.tsx` §04 names Supabase/Stripe/Resend/Vercel/CloudFront/Sentry. Add: *"Amazon Web Services (AWS S3) for encrypted storage of user-uploaded study-note photos."* (CloudFront is already AWS, so the stack isn't AWS-naive, but the new sensitive-data store must be named.)
- **Disclose photo storage** in §02 (which says nothing about uploaded photos today): *"If you attach photos to your notes, we store those images. Store only what you're comfortable keeping."* (No em-dashes in shipped copy.)
- **Retention line:** *"Note photos are kept until you delete the note or your account."* Converts "indefinite + unstated" into "user-controlled + stated."
- **AUP line** (third-party faces, since photos can contain classmates): *"Only upload photos of your own study materials. Don't upload images of other people without their permission."*
- **EU residency:** bucket is us-east-1; EU photos transfer to the US exactly as the existing Supabase/Vercel/CloudFront footprint already does. Covered by AWS's standard DPA / DPF — **accept the standard AWS DPA, sign nothing custom.** Not a pilot blocker; revisit (eu-central-1) only before a deliberate EU push.
- **Encryption claim:** SSE-S3 (AES256) fully backs an "encrypted at rest" statement. SSE-KMS is the upgrade trigger before any school/FERPA or SOC2 deal, not now.

---

## 9. Migration strategy (zero backfill, reversible)

- **Dual-read, new-write-to-S3.** New uploads → S3 (`user-uploads/` token). Existing photos stay on Supabase (`note-images/` token) and resolve via the unchanged Supabase path. The resolver routes by token prefix.
- **No backfill.** Old objects are never touched. If the pilot succeeds and we want consolidation, a one-time copy job is a separate, later decision.
- **Rollback:** point the iOS upload back at `supabase.storage.upload` and revert the token prefix. Both token formats remain readable throughout, so **no data is ever stranded.** This is the safety property that makes the pilot low-risk.

---

## 10. Cost (🔴 flagged — not $0)

| Meter | Rate | At pilot scale |
|---|---|---|
| Storage | ~$0.023/GB-mo | 10k photos × 2 MB = 20 GB ≈ **$0.46/mo** |
| PUT/GET requests | $0.005/1k PUT, $0.0004/1k GET | pennies |
| **Egress (the meter to watch)** | ~$0.09/GB (direct from S3) | the real variable; a hot notes view re-fetches images |

🔴 **Net: low single-digit $/mo at pilot scale, but genuinely not zero.** The egress line is why **CloudFront is the phase-2 follow-up** (cheaper egress + edge caching + it formalizes the existing manual CloudFront under IaC — a twofer with the AWS roadmap's CloudFront item). Mitigate now by keeping the read TTL/cache and not auto-refetching.

---

## 11. Build sequence (cross-platform)

**Phase A — web + infra (admin), shippable alone:**
1. Terraform: bucket + BPA + SSE + versioning + CORS + lifecycle + scoped IAM user. `plan` → review → `apply` (staging first).
2. Add AWS SDK deps + the S3 client helper (`lib/s3.ts`).
3. `POST /api/note-images/presign` (presigned POST).
4. `GET /api/note-images/sign-read` (ownership-checked presigned GET).
5. Dual-backend `getSignedNoteImageUrl` + `TOKEN_RE` extension in `lib/note-images.ts`.
6. `deleteUserNoteImagesFromS3` + wire into the reaper.
7. Tests: a manual presigned upload + read round-trip; verify BPA blocks a direct public GET; verify a cross-user `sign-read` is rejected.

   *Until iOS ships Phase B, nothing writes to S3 — Phase A is dormant and safe in prod.*

**Phase B — iOS (vp-ios):**
8. Swap the iOS note-image upload: call `/api/note-images/presign` → POST bytes to S3 → write the `user-uploads/` token.
9. Update the iOS `lib/note-images.ts` mirror (token regex + read routing through `/api/note-images/sign-read`).
10. iOS QA: upload, render, offline, account-delete purge.

---

## 12. Done-definition

- IOS_PARITY row (cross-platform: web/infra + iOS upload).
- security-auth-guardian review of both new routes (ownership checks, no client userId trust) + security-auditor on the IAM policy least-privilege.
- quality-code-reviewer + quality-qa-tester (web) / ios-code-reviewer + ios-qa-tester (iOS).
- business-legal-compliance sign-off on the GDPR purge + a note in the Privacy Policy that uploads are stored encrypted at rest.
- quality-docs-writer (CHANGELOG + FEATURES) + vault log.

---

## 13. Open questions / risks

1. **Credential model:** scoped IAM-user keys in Vercel env for the pilot vs Vercel→AWS OIDC. Pilot = keys; flag OIDC as the hardening follow-up.
2. **Egress without CloudFront:** acceptable at pilot scale; revisit before any volume.
3. **HEIC:** Supabase currently allows `image/heic`; the pilot rejects heic at upload (browser display + future OCR are both weak on heic). This is a *tightening*, not a regression — confirm iOS already exports jpg (it generally does for picked photos).
4. **iOS is the write path:** Phase A delivers no user-visible change alone; the pilot only "lands" once iOS ships Phase B. Decide whether to ship A now (infra ready, learning done) or hold A until B is scheduled.
