import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, maskEmail } from "@/lib/admin-auth";

/**
 * GET /api/admin/users/[id] — full support view of a single user. Staff only.
 *
 * Returns the profile, auth metadata (creation, last sign-in, suspension
 * state), the last 15 Fang transactions, and the last 15 audit-log entries
 * targeting this user. Email is masked for everyone — the raw value is a
 * separate audited admin action (./email).
 */

type RouteCtx = { params: { id: string } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "support");
  if (staff instanceof NextResponse) return staff;

  const userId = params.id;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const [profileRes, authRes, txRes, auditRes] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, role, coins, fangs_cashable, fangs_iap, lifetime_fangs_spent, xp, level, streak, max_streak, plan, subscription_tier, created_at, last_seen, onboarding_completed",
      )
      .eq("id", userId)
      .single(),
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("coin_transactions")
      .select("id, amount, type, description, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(15),
    supabaseAdmin
      .from("admin_audit_log")
      .select("id, performed_by, action, metadata, created_at")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  if (profileRes.error || !profileRes.data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const p = profileRes.data;
  const authUser = authRes.data?.user ?? null;
  const bannedUntil =
    (authUser as { banned_until?: string } | null)?.banned_until ?? null;
  const suspended = Boolean(bannedUntil && new Date(bannedUntil) > new Date());

  return NextResponse.json({
    user: {
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      role: p.role ?? "user",
      coins: p.coins,
      fangsCashable: Number(p.fangs_cashable ?? 0),
      fangsIap: Number(p.fangs_iap ?? 0),
      lifetimeFangsSpent: Number(p.lifetime_fangs_spent ?? 0),
      xp: p.xp,
      level: p.level,
      streak: p.streak,
      maxStreak: p.max_streak,
      plan: p.plan,
      subscriptionTier: p.subscription_tier,
      createdAt: p.created_at,
      lastSeen: p.last_seen,
      onboardingCompleted: p.onboarding_completed,
      emailMasked: maskEmail(authUser?.email ?? null),
      emailConfirmedAt: authUser?.email_confirmed_at ?? null,
      lastSignInAt: authUser?.last_sign_in_at ?? null,
      suspended,
      bannedUntil: suspended ? bannedUntil : null,
    },
    transactions: txRes.data ?? [],
    // Audit entries are staff-facing context on the profile page; the full
    // filterable log at /admin/audit stays admin-only.
    auditEntries: auditRes.data ?? [],
  });
}
