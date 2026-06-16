// POST /api/admin/vault/rotate — re-seal every stored secret under the ACTIVE
// at-rest key. ADMIN ONLY.
//
// This is phase 2 of the zero-downtime key rotation described in
// lib/vault/crypto.ts. The operator has already moved the old key into
// CREDENTIAL_ENCRYPTION_KEY_PREVIOUS and set a freshly generated key as the
// active CREDENTIAL_ENCRYPTION_KEY. While both vars are live, reveals keep
// working (decryptSecretFlexible falls back to the previous key). This route
// walks every row, decrypts it (active key first, previous key as fallback),
// and re-encrypts it with the active key, so that afterwards the operator can
// safely drop CREDENTIAL_ENCRYPTION_KEY_PREVIOUS from the environment.
//
// SECURITY INVARIANTS (non-negotiable):
//   - requireRole(req, "admin") gates the route as the first action.
//   - assertTrustedOrigin (defense in depth) runs before any DB read.
//   - isVaultConfigured() gates the crypto path with a clean 503.
//   - CREDENTIAL_ENCRYPTION_KEY_PREVIOUS must be set, or there is nothing to
//     rotate FROM; we refuse with a 400 rather than silently re-encrypting
//     everything under the same key.
//   - DECRYPTED PLAINTEXT NEVER LEAVES THIS SERVER. It exists only transiently
//     inside the loop between decrypt and re-encrypt, and is never logged,
//     never audited, and never placed in the response. The response and audit
//     carry only counts and the ids that FAILED — never any secret material.
//   - Per-row try/catch: a single bad row (tampered, or unopenable by either
//     key) is collected into failedIds and the loop continues. Re-running the
//     route safely re-processes everything: an already-rotated row simply
//     decrypts under the active key and is re-sealed under the same key. The
//     operation is therefore idempotent and re-runnable.
//   - The audit row records { total, rotated, failed_ids } only.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";
import {
  assertTrustedOrigin,
  UntrustedOriginError,
} from "@/lib/team/origin-check";
import {
  decryptSecretFlexible,
  encryptSecret,
  isVaultConfigured,
  readPreviousKey,
} from "@/lib/vault/crypto";

/** The sealed-secret columns plus id — the only columns this route reads. No
 *  label, username, url, or notes are loaded: rotation touches ciphertext only. */
interface SealedRow {
  id: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
}

export async function POST(req: NextRequest) {
  // 1) AuthZ — admin only.
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  // 2) Defense-in-depth origin check before any side effect.
  try {
    assertTrustedOrigin(req);
  } catch (e) {
    if (e instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: e.status });
    }
    throw e;
  }

  // 3) Env preflight — refuse to attempt crypto we cannot perform.
  if (!isVaultConfigured()) {
    return NextResponse.json(
      { error: "Credential vault not configured: set CREDENTIAL_ENCRYPTION_KEY" },
      { status: 503 },
    );
  }

  // 4) Rotation requires a previous key to rotate FROM. Without it there is
  //    nothing to migrate, and re-encrypting everything under the same active
  //    key would be a pointless, misleading operation. Fail with a clear 400.
  if (!readPreviousKey()) {
    return NextResponse.json(
      {
        error:
          "Key rotation requires CREDENTIAL_ENCRYPTION_KEY_PREVIOUS to be set to the prior key",
      },
      { status: 400 },
    );
  }

  // 5) Load every sealed row. We select ONLY id + the three secret columns;
  //    nothing else is needed to re-seal.
  const { data: rows, error } = await supabaseAdmin
    .from("shared_credentials")
    .select("id, secret_ciphertext, secret_iv, secret_auth_tag")
    .returns<SealedRow[]>();

  if (error) {
    console.error("[admin/vault/rotate]", error.message);
    return NextResponse.json(
      { error: "Unable to rotate credentials" },
      { status: 500 },
    );
  }

  const total = rows?.length ?? 0;
  const failedIds: string[] = [];
  let rotatedCount = 0;

  // 6) Walk every row. Per-row try/catch isolates failures so one unopenable or
  //    un-writable row never aborts the batch. Plaintext lives only inside this
  //    block and is never logged, audited, or returned.
  for (const row of rows ?? []) {
    try {
      // Decrypt under active key, falling back to the previous key for rows not
      // yet rotated. usedPreviousKey is intentionally ignored: we always re-seal.
      const { plaintext } = decryptSecretFlexible({
        ciphertext: row.secret_ciphertext,
        iv: row.secret_iv,
        authTag: row.secret_auth_tag,
      });

      // Re-seal under the ACTIVE key (encryptSecret never touches the previous key).
      const sealed = encryptSecret(plaintext);

      const { error: updateError } = await supabaseAdmin
        .from("shared_credentials")
        .update({
          secret_ciphertext: sealed.ciphertext,
          secret_iv: sealed.iv,
          secret_auth_tag: sealed.authTag,
          updated_at: new Date().toISOString(),
          updated_by: staff.userId,
        })
        .eq("id", row.id);

      if (updateError) {
        // Persist failed: collect the id and move on. A re-run retries it.
        // The DB error message may be benign, but we keep logs detail-free for
        // this route; the id alone is enough to investigate.
        failedIds.push(row.id);
        continue;
      }

      rotatedCount += 1;
    } catch {
      // Decrypt or encrypt threw (tampered row, or unopenable by either key).
      // No secret detail is leaked; record only the id for follow-up.
      failedIds.push(row.id);
    }
  }

  // 7) Audit the rotation. Metadata carries counts + the failed ids only —
  //    NEVER any plaintext or sealed secret material.
  const audit = await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "vault_rotate",
    targetUserId: null,
    metadata: { total, rotated: rotatedCount, failed_ids: failedIds },
  });

  const allOk = failedIds.length === 0;
  return NextResponse.json(
    {
      ok: allOk,
      rotatedCount,
      failedIds,
      ...(audit.ok ? {} : { audit_log_failed: true }),
    },
    { status: allOk ? 200 : 207 },
  );
}
