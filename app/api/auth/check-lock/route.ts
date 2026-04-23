import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * Returns whether the given email is currently rate-limited on login
 * (N failed attempts within a rolling window). Reads `login_attempts`.
 *
 * ALWAYS fails open — if the table is missing or the DB call errors, we
 * return `{ locked: false }` with HTTP 200. Brute-force protection is a
 * defense-in-depth feature, not a correctness requirement: if it can't
 * run, a legitimate user should still be able to log in.
 */

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS   = 5;

// Postgres error code for "relation does not exist" — the dominant failure
// mode when migration 026 hasn't been applied yet. We quiet-swallow it so
// dev logs don't scream on every login attempt.
const PG_UNDEFINED_TABLE = "42P01";

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ locked: false });
  }

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  try {
    const { count, error } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .eq("success", false)
      .gte("attempted_at", windowStart);

    if (error) {
      // Table missing → silent fail-open (expected in fresh envs).
      // Any other error → log but still fail-open.
      if (error.code !== PG_UNDEFINED_TABLE) {
        console.error("[check-lock] DB error:", error.message);
      }
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
  } catch (e) {
    // Network / unexpected exception — never block login on this path.
    const msg = e instanceof Error ? e.message : "unknown";
    if (!msg.includes("does not exist")) {
      console.error("[check-lock] exception:", msg);
    }
    return NextResponse.json({ locked: false });
  }
}
