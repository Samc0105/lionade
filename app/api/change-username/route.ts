import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { newUsername } = await req.json();
    if (!newUsername || typeof newUsername !== "string") {
      return NextResponse.json({ error: "Missing newUsername" }, { status: 400 });
    }

    const clean = newUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (clean.length < 3 || clean.length > 20) {
      return NextResponse.json({ error: "Username must be 3-20 characters" }, { status: 400 });
    }

    // Get current profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (profile.username === clean) {
      return NextResponse.json({ error: "Username is the same" }, { status: 400 });
    }

    // Check last change — must be 365+ days ago
    const { data: lastChange } = await supabaseAdmin
      .from("username_changes")
      .select("changed_at")
      .eq("user_id", userId)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastChange) {
      const daysSince = (Date.now() - new Date(lastChange.changed_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 365) {
        const nextDate = new Date(new Date(lastChange.changed_at).getTime() + 365 * 24 * 60 * 60 * 1000);
        return NextResponse.json({
          error: `You can change your username again on ${nextDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
        }, { status: 403 });
      }
    }

    // Check uniqueness
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", clean)
      .neq("id", userId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    // Update username
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ username: clean })
      .eq("id", userId);

    if (updateErr) {
      console.error("[change-username]", updateErr.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    // Log the change
    await supabaseAdmin.from("username_changes").insert({
      user_id: userId,
      old_username: profile.username,
      new_username: clean,
    });

    // Sync auth metadata
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { username: clean },
    });

    return NextResponse.json({ success: true, username: clean });
  } catch (err) {
    console.error("[change-username]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
