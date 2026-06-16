// PATCH  /api/admin/vault/[id] — update a stored credential (optionally rotate
//                                 the sealed secret).
// DELETE /api/admin/vault/[id] — permanently remove a stored credential.
// ADMIN ONLY.
//
// SECURITY INVARIANTS (non-negotiable):
//   - requireRole(req, "admin") gates BOTH handlers as the first action.
//   - Both are mutations: assertTrustedOrigin (defense in depth) runs before any
//     write, mapping an untrusted origin to 403.
//   - The id is validated with isUuid before it touches the DB.
//   - PATCH re-seals the secret ONLY when a non-empty `secret` is supplied. When
//     a new secret is provided the route refuses to proceed unless the vault is
//     configured (isVaultConfigured) so we never half-write a rotation.
//   - The new plaintext secret is sealed by encryptSecret() and persisted only
//     as ciphertext. It is NEVER logged, NEVER written to audit metadata
//     (the audit records only the list of field NAMES changed), and NEVER
//     returned. The PATCH response echoes non-secret fields only.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, isUuid } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";
import {
  assertTrustedOrigin,
  UntrustedOriginError,
} from "@/lib/team/origin-check";
import { encryptSecret, isVaultConfigured } from "@/lib/vault/crypto";
import { VAULT_NON_SECRET_COLUMNS, type VaultItem } from "@/lib/vault/types";

type RouteCtx = { params: { id: string } };

const MAX_LABEL = 200;
const MAX_CATEGORY = 80;
const MAX_USERNAME = 320;
const MAX_URL = 2048;
const MAX_NOTES = 5000;
const MAX_SECRET = 8000;

interface UpdateBody {
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

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
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

  // 4) Parse + validate the body.
  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Build the patch from only the keys the caller actually sent. `updated_by`
  // is always set; `updated_at` is maintained by the DB trigger but we set it
  // here too so the timestamp moves even if the trigger is absent before the
  // migration runs.
  const patch: Record<string, unknown> = {
    updated_by: staff.userId,
    updated_at: new Date().toISOString(),
  };
  const fieldsChanged: string[] = [];

  if (Object.prototype.hasOwnProperty.call(body, "label")) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label.length < 1 || label.length > MAX_LABEL) {
      return NextResponse.json(
        { error: `label must be 1-${MAX_LABEL} characters` },
        { status: 400 },
      );
    }
    patch.label = label;
    fieldsChanged.push("label");
  }

  if (Object.prototype.hasOwnProperty.call(body, "category")) {
    const category = optionalString(body.category);
    if (category && category.length > MAX_CATEGORY) {
      return NextResponse.json(
        { error: `category must be at most ${MAX_CATEGORY} characters` },
        { status: 400 },
      );
    }
    patch.category = category;
    fieldsChanged.push("category");
  }

  if (Object.prototype.hasOwnProperty.call(body, "username")) {
    const username = optionalString(body.username);
    if (username && username.length > MAX_USERNAME) {
      return NextResponse.json(
        { error: `username must be at most ${MAX_USERNAME} characters` },
        { status: 400 },
      );
    }
    patch.username = username;
    fieldsChanged.push("username");
  }

  if (Object.prototype.hasOwnProperty.call(body, "url")) {
    const url = optionalString(body.url);
    if (url && url.length > MAX_URL) {
      return NextResponse.json(
        { error: `url must be at most ${MAX_URL} characters` },
        { status: 400 },
      );
    }
    patch.url = url;
    fieldsChanged.push("url");
  }

  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    const notes = optionalString(body.notes);
    if (notes && notes.length > MAX_NOTES) {
      return NextResponse.json(
        { error: `notes must be at most ${MAX_NOTES} characters` },
        { status: 400 },
      );
    }
    patch.notes = notes;
    fieldsChanged.push("notes");
  }

  // Re-seal the secret ONLY when a non-empty secret was supplied. We treat an
  // omitted key or an empty string as "keep the existing secret" so an edit of
  // the display fields never blanks the credential.
  const rawSecret = typeof body.secret === "string" ? body.secret : "";
  const rotatingSecret = rawSecret.length > 0;
  if (rotatingSecret) {
    if (rawSecret.length > MAX_SECRET) {
      return NextResponse.json(
        { error: `secret must be at most ${MAX_SECRET} characters` },
        { status: 400 },
      );
    }
    // Only enforce vault config when we actually need to encrypt.
    if (!isVaultConfigured()) {
      return NextResponse.json(
        { error: "Credential vault not configured: set CREDENTIAL_ENCRYPTION_KEY" },
        { status: 503 },
      );
    }
    try {
      const sealed = encryptSecret(rawSecret);
      patch.secret_ciphertext = sealed.ciphertext;
      patch.secret_iv = sealed.iv;
      patch.secret_auth_tag = sealed.authTag;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "encrypt failed";
      console.error("[admin/vault/update] encrypt failed:", msg);
      return NextResponse.json(
        { error: "Unable to update credential" },
        { status: 500 },
      );
    }
    // Record only that the secret was rotated — never the value.
    fieldsChanged.push("secret");
  }

  if (fieldsChanged.length === 0) {
    return NextResponse.json(
      { error: "No updatable fields supplied" },
      { status: 400 },
    );
  }

  // 5) Update. The returned projection is NON-secret columns only.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("shared_credentials")
    .update(patch)
    .eq("id", id)
    .select(VAULT_NON_SECRET_COLUMNS)
    .maybeSingle<VaultItem>();

  if (updateError) {
    console.error("[admin/vault/update]", updateError.message);
    return NextResponse.json(
      { error: "Unable to update credential" },
      { status: 500 },
    );
  }
  if (!updated) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  // 6) Audit AFTER success. Only the id + the list of field NAMES changed.
  const audit = await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "vault_update",
    metadata: { credential_id: updated.id, fields_changed: fieldsChanged },
  });

  return NextResponse.json({
    ok: true,
    credential: updated,
    ...(audit.ok ? {} : { audit_log_failed: true }),
  });
}

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
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

  // 4) Delete, returning the label so the audit row is meaningful AND so a
  //    missing row reports a clean 404 (no rows returned).
  const { data: deleted, error: deleteError } = await supabaseAdmin
    .from("shared_credentials")
    .delete()
    .eq("id", id)
    .select("id, label")
    .maybeSingle<Pick<VaultItem, "id" | "label">>();

  if (deleteError) {
    console.error("[admin/vault/delete]", deleteError.message);
    return NextResponse.json(
      { error: "Unable to delete credential" },
      { status: 500 },
    );
  }
  if (!deleted) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  // 5) Audit AFTER success — id + label only.
  const audit = await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "vault_delete",
    metadata: { credential_id: deleted.id, label: deleted.label },
  });

  return NextResponse.json({
    ok: true,
    ...(audit.ok ? {} : { audit_log_failed: true }),
  });
}
