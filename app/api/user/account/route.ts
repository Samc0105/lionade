/**
 * /api/user/account — account lifecycle (read state + schedule deletion).
 *
 * GET    -> account state for the authenticated caller (email + the two
 *           lifecycle timestamps the settings UI reacts to).
 * DELETE -> SCHEDULE a deletion 24h out (deferred hard delete). The actual
 *           auth.users row removal happens later via the reaper cron at
 *           /api/cron/reap-pending-deletions. KEEPS the email-typed
 *           confirmation gate + demo block from the original hard-delete.
 *
 * ── History ──
 * P0 trust-gap fix 2026-06-05 wired DELETE as an immediate hard delete
 * (supabase.auth.admin.deleteUser) for the previously-dead Danger Zone
 * "Delete Account" button.
 *
 * Settings overhaul 2026-06-11 changed DELETE to a DEFERRED delete:
 * instead of removing the row inline, it stamps profiles.pending_deletion_at
 * = now + 24h and returns that timestamp. This gives users a 24h grace
 * window to change their mind (the /settings layout banner + Danger Zone
 * page both surface a "Cancel deletion" affordance that hits
 * /api/user/account/cancel-deletion). A daily cron reaps any account whose
 * window has elapsed. Migration 060 added the pending_deletion_at +
 * deactivated_at columns — no migration here.
 *
 * Confirmation contract (unchanged):
 *
 *   The `confirm` query param MUST match the email on the JWT
 *   (case-insensitive). The Lionade core ApiClient.delete helper can't send
 *   a body, so the token rides the query string. This is safe because the
 *   user can only act on themselves (auth.userId is from the JWT, never
 *   trusted from input) — `confirm` is purely an "I really meant it" latch
 *   matching the modal UX ("type your email to confirm").
 *
 * Auth: requireAuth. There is no userId parameter; we always act on
 * auth.userId.
 *
 * Demo user: BLOCKED on DELETE. The demo account is a publicly-known shared
 * fixture (lib/demo-guard.ts) — letting anyone schedule its deletion would
 * brick the demo for the next visitor. GET is allowed for the demo account
 * so the Danger Zone page renders normally.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDemoUser } from "@/lib/demo-guard";

export const dynamic = "force-dynamic";

// Grace window between scheduling and the reaper hard-deleting the account.
const DELETION_GRACE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * GET /api/user/account
 *
 * Returns the caller's account state. Frozen contract — the /settings layout
 * PendingDeletionBanner and the Danger Zone page both read this shape:
 *
 *   { ok: true, data: { email, pending_deletion_at, deactivated_at } }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("pending_deletion_at, deactivated_at")
    .eq("id", auth.userId)
    .maybeSingle();

  if (error) {
    console.error("[api/user/account GET]", error.message);
    return NextResponse.json({ error: "Failed to load account" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      email: auth.email ?? null,
      pending_deletion_at: data?.pending_deletion_at ?? null,
      deactivated_at: data?.deactivated_at ?? null,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  // Demo guard first — the publicly-known account must not be deletable.
  if (isDemoUser(auth.userId)) {
    return NextResponse.json(
      { error: "Demo accounts can't be deleted. Sign up to try it for real." },
      { status: 403 },
    );
  }

  const confirm = (req.nextUrl.searchParams.get("confirm") ?? "").trim().toLowerCase();
  const email   = (auth.email ?? "").trim().toLowerCase();

  if (!email) {
    // Shouldn't happen — JWT-authenticated users always have an email —
    // but defend against a future passwordless-only enrollment.
    return NextResponse.json(
      { error: "Your account has no email on file. Contact support@getlionade.com to delete." },
      { status: 400 },
    );
  }

  if (confirm !== email) {
    return NextResponse.json(
      { error: "Confirmation email does not match. Type your account email exactly." },
      { status: 400 },
    );
  }

  // Deferred delete: stamp the deletion window instead of removing the row.
  // The reaper (/api/cron/reap-pending-deletions) performs the actual
  // supabase.auth.admin.deleteUser once pending_deletion_at < now.
  const pendingDeletionAt = new Date(Date.now() + DELETION_GRACE_MS).toISOString();

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ pending_deletion_at: pendingDeletionAt })
    .eq("id", auth.userId);

  if (error) {
    console.error("[api/user/account DELETE]", error.message);
    return NextResponse.json({ error: "Failed to schedule deletion" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pending_deletion_at: pendingDeletionAt });
}
