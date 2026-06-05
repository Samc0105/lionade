import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET — Fetch notifications for the authenticated user
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("id, user_id, type, title, message, read, action_url, related_user_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("[notifications GET]", error.message);
      return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
    }

    const unreadCount = (data ?? []).filter((n) => !n.read).length;

    return NextResponse.json({ notifications: data ?? [], unreadCount });
  } catch (e) {
    console.error("[notifications GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Update notification read state.
//
// 2026-06-05 Bucket C #3 — extended from mark-all-read-only to support per-row
// mark / unmark plus an explicit mark-all action. The Gmail/Slack model: the
// dropdown panel no longer auto-marks-everything-read on open (destructive to
// any state the user wanted to leave for later), so the UI needs both flavors.
//
// Body shapes:
//   {}                            → legacy: mark all unread as read (back-compat
//                                   for any caller that still posts an empty body)
//   { all: true }                 → explicit mark-all-read
//   { id: string, read: boolean } → per-row toggle (the row must belong to the
//                                   authenticated user — server scopes the
//                                   update by user_id to enforce this)
//
// All three return { success: true }; the per-row form additionally returns
// { id, read } so the optimistic client can reconcile against the server truth.
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Body is optional — an empty PATCH preserves the legacy mark-all behavior.
  let body: { id?: unknown; read?: unknown; all?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    // tolerate empty / non-JSON bodies — fall through to mark-all
    body = {};
  }

  try {
    // ── Per-row toggle ─────────────────────────────────────────────────────
    // Both `id` AND `read` must be present to disambiguate from mark-all.
    // We scope the update by user_id so a forged id can't mutate someone
    // else's notification (defense-in-depth — the GET already only returns
    // rows owned by the user, but server-side ownership enforcement on
    // writes is the load-bearing one).
    if (typeof body.id === "string" && typeof body.read === "boolean") {
      const id = body.id;
      const next = body.read;

      const { data, error } = await supabaseAdmin
        .from("notifications")
        .update({ read: next })
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("[notifications PATCH per-row]", error.message);
        return NextResponse.json({ error: "Failed to update" }, { status: 500 });
      }
      if (!data) {
        // Either the row doesn't exist or it's owned by another user —
        // both surface as 404 so we don't leak ownership info.
        return NextResponse.json({ error: "Notification not found" }, { status: 404 });
      }

      return NextResponse.json({ success: true, id, read: next });
    }

    // ── Mark all (explicit or legacy empty body) ────────────────────────────
    await supabaseAdmin
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[notifications PATCH]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
