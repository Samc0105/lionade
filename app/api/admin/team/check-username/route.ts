import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";

/**
 * GET /api/admin/team/check-username?username=<local-part> — ADMIN ONLY.
 *
 * Pre-flight availability check for a prospective team mailbox local-part
 * (the part before @getlionade.com). Validates the same shape the DB CHECK
 * constraint enforces on team_members.username (^[a-z][a-z0-9.-]{2,30}$),
 * rejects a reserved/system name list, then checks the team_members table
 * for a collision.
 *
 * Read-only: no writes, no admin_audit_log entry (a username check is not a
 * privileged action and produces no side effects).
 *
 * Response shape:
 *   { available: true }
 *   { available: false, reason: "<human message>" }
 */

// MUST mirror the team_members.username CHECK constraint
// (migration 20260616121503). The DB is authoritative; this is a UX-grade
// pre-check so the form can flag a bad/taken username before submit.
const USERNAME_RE = /^[a-z][a-z0-9.-]{2,30}$/;

// System / role / no-reply style names that must never become a personal
// team mailbox even if the regex would otherwise allow them. Lowercase only —
// the username is already validated as lowercase by USERNAME_RE.
const RESERVED_USERNAMES = new Set<string>([
  "admin",
  "administrator",
  "support",
  "root",
  "no-reply",
  "noreply",
  "postmaster",
  "abuse",
  "hostmaster",
  "webmaster",
  "security",
  "billing",
  "info",
  "help",
  "team",
  "sales",
  "contact",
  "mailer-daemon",
  "system",
]);

export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  // Normalise: trim, lowercase, cap length so a giant query string can't be
  // used to probe. The regex enforces the real bound (3–31 chars total).
  const username = (req.nextUrl.searchParams.get("username") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 64);

  if (!username) {
    return NextResponse.json(
      { available: false, reason: "Username is required" },
      { status: 400 },
    );
  }

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({
      available: false,
      reason:
        "Must be 3–31 characters: start with a letter, then lowercase letters, numbers, dots, or hyphens.",
    });
  }

  if (RESERVED_USERNAMES.has(username)) {
    return NextResponse.json({
      available: false,
      reason: "That name is reserved for system use.",
    });
  }

  // Uniqueness check against team_members. maybeSingle() returns null (no
  // error) when nothing matches — exactly the "available" case.
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    // Never echo the raw Supabase message; log it and return a generic 500.
    console.error("[admin/team/check-username] lookup failed:", error.message);
    return NextResponse.json(
      { error: "Username check unavailable" },
      { status: 500 },
    );
  }

  if (data) {
    return NextResponse.json({
      available: false,
      reason: "That username is already taken.",
    });
  }

  return NextResponse.json({ available: true });
}
