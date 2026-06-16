// POST /api/team/me/clear-password-flag — the CALLER clears their own
// "must change password" flag after setting a fresh permanent password.
//
// Called by the forced-password onboarding page (and best-effort by the
// recovery-link reset page) once supabase.auth.updateUser({ password }) has
// succeeded. It clears the flag in TWO places so the onboarding gate stops
// re-prompting:
//   1) team_members.must_change_password (the admin-facing source of truth)
//   2) user_metadata.must_change_password (read zero-network by TeamGate)
//
// SECURITY INVARIANTS (non-negotiable):
//   - getAuthedUser(req) resolves the subject from the bearer JWT. The route
//     acts ONLY on the caller's own account (auth.userId). No id is ever read
//     from the body.
//   - Idempotent: a caller who is not a team member, or whose flag is already
//     clear, still gets { ok: true }. There is nothing sensitive to leak and no
//     state to corrupt by re-running.
//   - Generic error bodies. Supabase error.message is logged server-side only.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getAuthedUser } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  // 1) Resolve the caller from the bearer token. No body, no id from the wire.
  const auth = await getAuthedUser(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = auth.userId;

  // 2) Clear the column on the caller's OWN team_members row. If they have no
  //    row (not a team member) this updates nothing, which is fine — idempotent.
  const nowIso = new Date().toISOString();
  const { error: rowErr } = await supabaseAdmin
    .from("team_members")
    .update({ must_change_password: false, updated_at: nowIso })
    .eq("user_id", userId);
  if (rowErr) {
    // Log only; do not echo. We still attempt the metadata clear below so the
    // gate can be satisfied even if the row write transiently failed.
    console.error("[team/me/clear-password-flag] row update:", rowErr.message);
  }

  // 3) Clear user_metadata.must_change_password, preserving the rest of the
  //    metadata. Read the current user first so we never blow away other keys
  //    (username, role, full_name, mfa_required, ...).
  const { data: userRes, error: getErr } =
    await supabaseAdmin.auth.admin.getUserById(userId);
  if (getErr || !userRes?.user) {
    // The column clear above may already be enough for the gate; surface a
    // generic failure only if BOTH paths could not be confirmed.
    console.error(
      "[team/me/clear-password-flag] getUser:",
      getErr?.message ?? "no user",
    );
    if (rowErr) {
      return NextResponse.json({ error: "Unable to update account" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const existingMeta = (userRes.user.user_metadata ?? {}) as Record<string, unknown>;
  const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { ...existingMeta, must_change_password: false },
  });
  if (metaErr) {
    console.error("[team/me/clear-password-flag] metadata update:", metaErr.message);
    if (rowErr) {
      return NextResponse.json({ error: "Unable to update account" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
