// POST /api/user/profile-update — moderated server-side write of the editable
// profile fields (display_name, bio, education_level, study_goal).
//
// WHY: the profile edit form previously wrote these straight to profiles via the
// browser anon client (app/profile/page.tsx), so display_name + bio — both
// PUBLIC, user-authored text — bypassed moderateText entirely (every other UGC
// surface is moderated). This route is the server gate: requireAuth, moderate
// the free-text fields, then write via supabaseAdmin. Username is unchanged here
// (it has its own route, /api/change-username, with the 365-day cooldown).
//
// Body: { display_name?, bio?, education_level?, study_goal? }
// All optional; only provided keys are written.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import { moderateText, logFlagged } from "@/lib/moderation-ugc";

const MAX_DISPLAY_NAME = 50;
const MAX_BIO = 300;
const MAX_SHORT = 60; // education_level / study_goal

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (isDemoUser(userId)) return demoBlockedResponse();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, string> = {};

  // display_name + bio are public, user-authored → moderate before persisting.
  if (typeof body.display_name === "string") {
    const displayName = body.display_name.trim().slice(0, MAX_DISPLAY_NAME);
    if (displayName) {
      const mod = await moderateText(displayName);
      if (!mod.ok) {
        void logFlagged(userId, "display_name", displayName, mod);
        return NextResponse.json({ error: "That name isn't allowed. Try another." }, { status: 400 });
      }
    }
    updates.display_name = displayName;
  }

  if (typeof body.bio === "string") {
    const bio = body.bio.trim().slice(0, MAX_BIO);
    if (bio) {
      const mod = await moderateText(bio);
      if (!mod.ok) {
        void logFlagged(userId, "bio", bio, mod);
        return NextResponse.json({ error: "That bio isn't allowed. Keep it respectful." }, { status: 400 });
      }
    }
    updates.bio = bio;
  }

  // education_level / study_goal: short, lower-risk fields — length-cap + write.
  if (typeof body.education_level === "string") {
    updates.education_level = body.education_level.trim().slice(0, MAX_SHORT);
  }
  if (typeof body.study_goal === "string") {
    updates.study_goal = body.study_goal.trim().slice(0, MAX_SHORT);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update(updates)
    .eq("id", userId);

  if (error) {
    console.error("[user/profile-update]", error.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...updates });
}
