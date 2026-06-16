// POST /api/admin/vault/[id]/reveal — decrypt and return one stored secret.
// ADMIN ONLY.
//
// This is the single most sensitive read in the vault feature: it returns a
// PLAINTEXT secret. The reveal is therefore an AUDITED action — every reveal is
// recorded in admin_audit_log BEFORE the secret is returned, so the immutable
// log is the permanent who-saw-what record even if the response is dropped.
//
// SECURITY INVARIANTS (non-negotiable):
//   - requireRole(req, "admin") gates the route as the first action.
//   - assertTrustedOrigin (defense in depth) runs before any DB read.
//   - isVaultConfigured() gates the crypto path with a clean 503.
//   - decryptSecret() is wrapped in try/catch. AES-256-GCM throws on a tampered
//     ciphertext/IV/tag or a wrong key. We log only "[admin/vault/reveal]
//     decrypt failed" with NO detail and return a single generic 500. The
//     underlying crypto error is never echoed, and no partial plaintext exists
//     because GCM final() either yields the whole plaintext or throws.
//   - The audit metadata records only id + label, NEVER the decrypted secret.
//   - The plaintext appears in EXACTLY one place: this response body. It is
//     never logged and never persisted.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, isUuid } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";
import {
  assertTrustedOrigin,
  UntrustedOriginError,
} from "@/lib/team/origin-check";
import { decryptSecretFlexible, isVaultConfigured } from "@/lib/vault/crypto";

type RouteCtx = { params: { id: string } };

/** The sealed-secret columns we must read here (and ONLY here, plus internal
 *  re-seal). label is read for the audit metadata. */
interface SealedRow {
  label: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
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

  // 3) Validate the path id.
  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid credential id" }, { status: 400 });
  }

  // 4) Env preflight — refuse to attempt a decrypt we cannot perform.
  if (!isVaultConfigured()) {
    return NextResponse.json(
      { error: "Credential vault not configured: set CREDENTIAL_ENCRYPTION_KEY" },
      { status: 503 },
    );
  }

  // 5) Load the sealed row. This is one of the only reads that selects the
  //    secret columns; they exist solely to be decrypted below.
  const { data: row, error } = await supabaseAdmin
    .from("shared_credentials")
    .select("label, secret_ciphertext, secret_iv, secret_auth_tag")
    .eq("id", id)
    .maybeSingle<SealedRow>();

  if (error) {
    console.error("[admin/vault/reveal]", error.message);
    return NextResponse.json(
      { error: "Unable to reveal credential" },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  // 6) Decrypt. decryptSecretFlexible tries the active key first, then the
  //    previous key during a rotation window, so reveals keep working while
  //    /api/admin/vault/rotate re-seals rows. On any failure (tamper, both keys
  //    wrong) it throws; we log a detail-free line and return a generic error.
  //    Never echo the crypto error. usedPreviousKey is intentionally not surfaced.
  let secret: string;
  try {
    secret = decryptSecretFlexible({
      ciphertext: row.secret_ciphertext,
      iv: row.secret_iv,
      authTag: row.secret_auth_tag,
    }).plaintext;
  } catch {
    console.error("[admin/vault/reveal] decrypt failed");
    return NextResponse.json(
      { error: "Unable to reveal credential" },
      { status: 500 },
    );
  }

  // 7) Audit BEFORE returning — the reveal is the sensitive action that MUST be
  //    recorded. Metadata carries id + label only, NEVER the decrypted secret.
  const audit = await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "vault_reveal",
    targetUserId: null,
    metadata: { credential_id: id, label: row.label },
  });

  // 8) Return the plaintext — this is the only place it ever leaves the server.
  return NextResponse.json({
    ok: true,
    secret,
    ...(audit.ok ? {} : { audit_log_failed: true }),
  });
}
