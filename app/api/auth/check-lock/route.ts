import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS   = 5;

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ locked: false });
  }

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabaseAdmin
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("success", false)
    .gte("attempted_at", windowStart);

  if (error) {
    // Fail open — don't block users if the check fails
    console.error("[check-lock] DB error:", error.message);
    return NextResponse.json({ locked: false });
  }

  const locked = (count ?? 0) >= MAX_ATTEMPTS;

  return NextResponse.json({
    locked,
    attemptsRemaining: locked ? 0 : MAX_ATTEMPTS - (count ?? 0),
    unlockAt: locked
      ? new Date(Date.now() + WINDOW_MINUTES * 60 * 1000).toISOString()
      : null,
  });
}
