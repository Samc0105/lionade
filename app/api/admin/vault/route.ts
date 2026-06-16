// GET  /api/admin/vault — list all stored credentials (NON-secret fields only).
// POST /api/admin/vault — create a new sealed credential.
// ADMIN ONLY.
//
// The credential vault stores shared team secrets (third-party logins, API
// tokens, infra passwords) sealed at rest with AES-256-GCM (see lib/vault/
// crypto.ts). The encryption key lives ONLY in the server environment
// (CREDENTIAL_ENCRYPTION_KEY), never in the database.
//
// SECURITY INVARIANTS (non-negotiable):
//   - requireRole(req, "admin") gates BOTH handlers as the first action.
//   - GET selects ONLY the non-secret columns (VAULT_NON_SECRET_COLUMNS). It
//     never reads or returns secret_ciphertext / secret_iv / secret_auth_tag.
//   - POST is a mutation: assertTrustedOrigin (defense in depth) runs before any
//     write, and the route refuses to encrypt until isVaultConfigured() is true.
//   - The plaintext secret is sealed by encryptSecret() and persisted only as
//     ciphertext. It is NEVER logged, NEVER written to admin_audit_log.metadata
//     (writeTeamAudit also strips credential-like keys as a last-line guard),
//     and NEVER returned in the response. The created row echoes non-secret
//     fields only.
//   - Every env read happens at call time inside the crypto helper; a missing
//     key surfaces as a clean 503, never an import-time crash.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";
import {
  assertTrustedOrigin,
  UntrustedOriginError,
} from "@/lib/team/origin-check";
import { encryptSecret, isVaultConfigured } from "@/lib/vault/crypto";
import { VAULT_NON_SECRET_COLUMNS, type VaultItem } from "@/lib/vault/types";

/** Upper bounds for the non-secret display fields. The secret itself is
 *  bounded separately below. These are generous; the point is to reject
 *  obviously abusive payloads, not to nitpick. */
const MAX_LABEL = 200;
const MAX_CATEGORY = 80;
const MAX_USERNAME = 320;
const MAX_URL = 2048;
const MAX_NOTES = 5000;
/** A single sealed secret should never be megabytes. Cap the plaintext. */
const MAX_SECRET = 8000;

interface CreateBody {
  label?: unknown;
  category?: unknown;
  username?: unknown;
  url?: unknown;
  notes?: unknown;
  secret?: unknown;
}

/** Normalize an optional string field: trim, empty -> null, else the value. */
function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(req: NextRequest) {
  // 1) AuthZ — admin only.
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  // 2) Read NON-secret columns only — the sealed-secret columns are never
  //    selected here, so they can never leak through the list endpoint.
  const { data, error } = await supabaseAdmin
    .from("shared_credentials")
    .select(VAULT_NON_SECRET_COLUMNS)
    .order("label", { ascending: true })
    .returns<VaultItem[]>();

  if (error) {
    console.error("[admin/vault/list]", error.message);
    return NextResponse.json(
      { error: "Failed to load credentials" },
      { status: 500 },
    );
  }

  return NextResponse.json({ credentials: data ?? [] });
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

  // 3) Env preflight — refuse to accept a secret we cannot seal.
  if (!isVaultConfigured()) {
    return NextResponse.json(
      { error: "Credential vault not configured: set CREDENTIAL_ENCRYPTION_KEY" },
      { status: 503 },
    );
  }

  // 4) Parse + validate. Specific 400s, no write yet.
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length < 1 || label.length > MAX_LABEL) {
    return NextResponse.json(
      { error: `label is required (1-${MAX_LABEL} characters)` },
      { status: 400 },
    );
  }

  const secret = typeof body.secret === "string" ? body.secret : "";
  if (secret.length < 1 || secret.length > MAX_SECRET) {
    return NextResponse.json(
      { error: `secret is required (1-${MAX_SECRET} characters)` },
      { status: 400 },
    );
  }

  const category = optionalString(body.category);
  const username = optionalString(body.username);
  const url = optionalString(body.url);
  const notes = optionalString(body.notes);

  if (category && category.length > MAX_CATEGORY) {
    return NextResponse.json(
      { error: `category must be at most ${MAX_CATEGORY} characters` },
      { status: 400 },
    );
  }
  if (username && username.length > MAX_USERNAME) {
    return NextResponse.json(
      { error: `username must be at most ${MAX_USERNAME} characters` },
      { status: 400 },
    );
  }
  if (url && url.length > MAX_URL) {
    return NextResponse.json(
      { error: `url must be at most ${MAX_URL} characters` },
      { status: 400 },
    );
  }
  if (notes && notes.length > MAX_NOTES) {
    return NextResponse.json(
      { error: `notes must be at most ${MAX_NOTES} characters` },
      { status: 400 },
    );
  }

  // 5) Seal the secret. encryptSecret reads + validates the key at call time;
  //    if the key is wrong shape it throws — caught here as a clean 503/500
  //    rather than leaking the underlying crypto error.
  let sealed;
  try {
    sealed = encryptSecret(secret);
  } catch (e) {
    // Do not echo the crypto error (it may name the key var). isVaultConfigured
    // already passed, so this is an unexpected encrypt failure.
    const msg = e instanceof Error ? e.message : "encrypt failed";
    console.error("[admin/vault/create] encrypt failed:", msg);
    return NextResponse.json(
      { error: "Unable to store credential" },
      { status: 500 },
    );
  }

  // 6) Insert. The created_by / updated_by are the acting admin. The returned
  //    projection is NON-secret columns only — the sealed columns never echo.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("shared_credentials")
    .insert({
      label,
      category,
      username,
      url,
      notes,
      secret_ciphertext: sealed.ciphertext,
      secret_iv: sealed.iv,
      secret_auth_tag: sealed.authTag,
      created_by: staff.userId,
      updated_by: staff.userId,
    })
    .select(VAULT_NON_SECRET_COLUMNS)
    .single<VaultItem>();

  if (insertError || !inserted) {
    console.error(
      "[admin/vault/create]",
      insertError?.message ?? "no row returned",
    );
    return NextResponse.json(
      { error: "Unable to store credential" },
      { status: 500 },
    );
  }

  // 7) Audit AFTER success. NEVER the secret — only the id + label.
  const audit = await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "vault_create",
    metadata: { credential_id: inserted.id, label: inserted.label },
  });

  return NextResponse.json(
    {
      ok: true,
      credential: inserted,
      ...(audit.ok ? {} : { audit_log_failed: true }),
    },
    { status: 201 },
  );
}
