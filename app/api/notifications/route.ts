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

// PATCH — Mark all notifications as read for the authenticated user
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
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
