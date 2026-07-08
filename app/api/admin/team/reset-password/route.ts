/**
 * POST /api/admin/team/reset-password — admin-triggered password reset for a
 * team member's Lionade login.
 *
 * What it does:
 *   1. Gates on requireRole(req, "admin") + assertTrustedOrigin (defense in
 *      depth — these are the most sensitive routes in the product).
 *   2. Looks up the target team_members row by id. The member must already be
 *      linked to an auth.users account (user_id) AND have a personal_email to
 *      deliver to; otherwise there is nothing to reset / nowhere to send.
 *   3. Mints a ONE-TIME Supabase recovery link via
 *      supabaseAdmin.auth.admin.generateLink({ type: "recovery", ... }) against
 *      the member's PERSONAL email (the canonical auth identity), then emails
 *      that link to the personal inbox via Resend.
 *   4. Re-arms must_change_password = true so the next sign-in forces a fresh
 *      permanent password.
 *   5. Audits the action as `team_password_reset`.
 *
 * SECURITY — credential hygiene (matches lib/team/password.ts + audit.ts):
 *   The recovery link is bearer-equivalent: anyone holding it can set the
 *   account's password until it is consumed/expires. So it is treated like a
 *   secret. It is NEVER written to logs, NEVER placed in admin_audit_log
 *   metadata, and only returned in the HTTP response when the admin explicitly
 *   asks (showLinkToAdmin) — and even then only to an already admin-gated
 *   caller. The email body is the intended delivery channel; we do not log it.
 *
 * Env-gated at CALL time (never at module load, so a missing var degrades to a
 * clear error instead of crashing the route file on import):
 *   RESEND_API_KEY, EMAIL_FROM.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, isUuid } from "@/lib/admin-auth";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import { writeTeamAudit } from "@/lib/team/audit";
import { sendResetEmail } from "@/lib/emails/reset-password";
import { absoluteUrl } from "@/lib/site-config";

export async function POST(req: NextRequest) {
  // --- 1. Auth: admin only --------------------------------------------------
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  // --- 2. Defense in depth: trusted origin ---------------------------------
  try {
    assertTrustedOrigin(req);
  } catch (err) {
    if (err instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: err.status });
    }
    throw err;
  }

  // --- 3. Parse + validate body --------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { id, showLinkToAdmin } = body as { id?: unknown; showLinkToAdmin?: unknown };

  if (typeof id !== "string" || !isUuid(id)) {
    return NextResponse.json({ error: "A valid team member id is required" }, { status: 400 });
  }
  if (showLinkToAdmin !== undefined && typeof showLinkToAdmin !== "boolean") {
    return NextResponse.json({ error: "showLinkToAdmin must be a boolean" }, { status: 400 });
  }
  const revealLink = showLinkToAdmin === true;

  // --- 4. Env gate (read at CALL time) -------------------------------------
  const resendKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!resendKey) {
    return NextResponse.json(
      { error: "Email not configured: set RESEND_API_KEY" },
      { status: 503 },
    );
  }
  if (!emailFrom) {
    return NextResponse.json(
      { error: "Email not configured: set EMAIL_FROM" },
      { status: 503 },
    );
  }

  // --- 5. Load the target team member --------------------------------------
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("team_members")
    .select("id, user_id, full_name, personal_email, status")
    .eq("id", id)
    .maybeSingle();

  if (memberErr) {
    console.error("[team/reset-password]", memberErr.message);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  // Narrow the supabase-js row to the fields we read. The project doesn't
  // generate Database generics, so select() returns a loosely-typed row; this
  // structural cast names the columns we depend on (no `any` introduced).
  const row = member as {
    user_id: string | null;
    full_name: string | null;
    personal_email: string | null;
  };

  // Must be linked to a real auth account to have a password to reset.
  if (!row.user_id) {
    return NextResponse.json(
      { error: "This member has no linked login account to reset" },
      { status: 400 },
    );
  }
  // Recovery is keyed off the auth identity (their personal email) and that is
  // also where the link is delivered. No personal_email => nothing to do.
  const personalEmail = (row.personal_email || "").trim();
  if (!personalEmail) {
    return NextResponse.json(
      { error: "This member has no personal email on file to send the reset to" },
      { status: 400 },
    );
  }

  // --- 6. Mint the one-time recovery link ----------------------------------
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: personalEmail,
    options: { redirectTo: absoluteUrl("/reset-password") },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error("[team/reset-password]", linkErr?.message ?? "no action_link returned");
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
  const resetUrl = linkData.properties.action_link;

  // --- 7. Deliver the link via Resend --------------------------------------
  // Shared helper (also used by the user-admin reset route). Renders + sends +
  // logs a safe error summary; never logs the link/body.
  const emailSent = await sendResetEmail({
    resendKey,
    emailFrom,
    to: personalEmail,
    fullName: row.full_name,
    resetUrl,
    receivingBecause: "You're receiving this because you're on the Lionade team.",
    logTag: "team/reset-password",
  });

  // If the admin asked to see the link, the email delivery is a convenience, so
  // a send failure is non-fatal. If they did NOT ask, the email is the only
  // delivery path, so a failure must surface as an error.
  if (!emailSent && !revealLink) {
    return NextResponse.json({ error: "Could not send the reset email" }, { status: 502 });
  }

  // --- 8. Re-arm must_change_password --------------------------------------
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabaseAdmin
    .from("team_members")
    .update({ must_change_password: true, updated_at: nowIso })
    .eq("id", id);

  const mustChangeFlagSet = !updateErr;
  if (updateErr) {
    // The recovery link is already valid and (usually) sent; losing the flag
    // doesn't undo the reset, so don't fail the request. Flag it in the audit.
    console.error("[team/reset-password]", updateErr.message);
  }

  // Also re-arm user_metadata.must_change_password so the onboarding gate
  // (TeamGate, zero-network) re-triggers after an admin reset. Best-effort:
  // the row flag above plus the recovery link are the source of truth, so a
  // metadata write failure here must NEVER fail the request. Preserve the
  // rest of the metadata by reading the current user first.
  try {
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
    if (userRes?.user) {
      const existingMeta = (userRes.user.user_metadata ?? {}) as Record<string, unknown>;
      const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(
        row.user_id,
        { user_metadata: { ...existingMeta, must_change_password: true } },
      );
      if (metaErr) {
        console.error("[team/reset-password] metadata re-arm:", metaErr.message);
      }
    }
  } catch (metaEx) {
    console.error(
      "[team/reset-password] metadata re-arm threw:",
      metaEx instanceof Error ? metaEx.message : "unknown",
    );
  }

  // --- 9. Audit (NEVER the link or any password) ---------------------------
  await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "team_password_reset",
    targetUserId: row.user_id,
    metadata: {
      team_member_id: id,
      delivery: "email",
      email_sent: emailSent,
      link_revealed_to_admin: revealLink,
      must_change_password_set: mustChangeFlagSet,
    },
  });

  // --- 10. Respond ---------------------------------------------------------
  // resetLink is included ONLY when the admin explicitly opted in. The route is
  // already admin-gated, so this stays within the trust boundary. It is never
  // logged or audited.
  const response: {
    ok: true;
    emailSent: boolean;
    mustChangePassword: true;
    resetLink?: string;
  } = {
    ok: true,
    emailSent,
    mustChangePassword: true,
  };
  if (revealLink) {
    response.resetLink = resetUrl;
  }
  return NextResponse.json(response);
}
