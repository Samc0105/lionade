/**
 * DELETE /api/user/account
 *
 * P0 trust-gap fix 2026-06-05.
 *
 * Permanently deletes the authenticated user's auth row. Was wired as a
 * "fix" to the dead Profile > Security > Danger Zone "Delete Account"
 * button — which previously rendered with no onClick handler.
 *
 * Confirmation contract:
 *
 *   Body MUST contain { confirm: "<the user's email>" }
 *   That confirmation must match the email on the JWT (case-insensitive).
 *   This makes accidentally-firing the DELETE from a dev console one
 *   step harder, and matches the modal UX ("type your email to confirm").
 *
 * Auth: requireAuth. The user can only delete themselves — there is no
 * userId parameter the caller can set; we always act on auth.userId.
 *
 * Demo user: BLOCKED. The demo account is a publicly-known shared
 * fixture (per lib/demo-guard.ts) — letting anyone log in and delete
 * it would brick the demo experience for the next visitor.
 *
 * Cascading data: profiles + every FK that points at the user row is
 * configured with ON DELETE CASCADE (existing Supabase schema). The
 * auth.users delete therefore cascades through profiles → friendships,
 * coin_transactions, quiz_sessions, daily_activity, etc. — there is no
 * manual cleanup loop here. If we ever need a soft-delete or a
 * scheduled-delete (GDPR 30-day grace), this is the route to extend.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDemoUser } from "@/lib/demo-guard";

export const dynamic = "force-dynamic";

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

  // The Lionade core ApiClient.delete helper doesn't support request
  // bodies, so the confirmation token comes through the query string
  // instead. This is safe because the user can only delete themselves
  // (auth.userId is from the JWT, never trusted from input) — the
  // confirm parameter is purely an "I really meant it" safety latch.
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

  // Hard delete via the admin API. supabase.auth.admin.deleteUser cascades
  // through the FKs the schema has set up (profiles, friendships, etc.).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(auth.userId);

  if (error) {
    console.error("[api/user/account DELETE]", error.message);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
