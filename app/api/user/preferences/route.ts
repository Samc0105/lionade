/**
 * GET  /api/user/preferences  → current notification + privacy + display prefs
 * PATCH /api/user/preferences → merge-update those prefs (server-side persistence)
 *
 * P0 trust-gap fix 2026-06-05.
 *
 * Before this route existed, the Profile NotificationsSection +
 * PrivacySection + Settings page notification/privacy toggles all wrote
 * to localStorage("notifPrefs") / localStorage("privacySettings") only.
 * Users lost their preferences whenever they cleared storage or signed
 * in on a new device, and the "Privacy: private" toggle in particular
 * was a TRUST gap — /api/social/search returned the user anyway.
 *
 * This route persists the toggles into profiles.preferences (JSONB) via
 * the existing lib/db.ts updatePreferences helper. Server-side ENFORCEMENT
 * of `profile_visibility` (public/private) lives in /api/user/profile-visibility
 * because it's a dedicated top-level column on profiles (used by the
 * leaderboard + social search filter paths).
 *
 * Demo user is NOT blocked from preference changes — they're local-only,
 * non-monetary, and harmless on a publicly-known shared account. (If
 * later we want to lock down demo prefs to defaults so testers always
 * see the same state, the guard is one line: `if (isDemoUser(userId))
 * return demoBlockedResponse();`)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_PRIVACY_PREFS,
  type NotificationPrefs,
  type PrivacyPrefs,
  type UserPreferences,
} from "@/lib/db";

export const dynamic = "force-dynamic";

// Allowlist for sub-keys we're willing to persist. Anything else in the
// payload gets dropped on the floor.
const NOTIF_KEYS: ReadonlyArray<keyof NotificationPrefs> = [
  "daily_reminder",
  "duel_challenges",
  "weekly_report",
  "badge_unlocked",
  "streak_alert",
  "new_features",
  "marketing",
  "leaderboard_updates",
  "friend_requests",
  "party_invites",
  // Settings overhaul 2026-06-11.
  "friend_accepted",
  "nudge_received",
  "bounty_completed",
  "fangs_received",
];

const PRIVACY_KEYS: ReadonlyArray<keyof PrivacyPrefs> = [
  "show_on_leaderboard",
  "show_streak",
  "show_coins",
  "duel_from",
  // Settings overhaul 2026-06-11.
  "online_status",
  "friend_request_from",
  "show_activity_feed",
];

// 24h "HH:MM" validator for quiet-hours bounds.
function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// Settings overhaul 2026-06-11: per-item EMAIL defaults. Email is opt-in;
// only the weekly report defaults email-on (matches DEFAULT_PREFERENCES in
// lib/db.ts, which is not exported).
const DEFAULT_NOTIFICATIONS_EMAIL: Partial<NotificationPrefs> = { weekly_report: true };

function sanitizeNotifications(input: unknown): Partial<NotificationPrefs> {
  if (!input || typeof input !== "object") return {};
  const out: Partial<NotificationPrefs> = {};
  for (const k of NOTIF_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function sanitizePrivacy(input: unknown): Partial<PrivacyPrefs> {
  if (!input || typeof input !== "object") return {};
  const out: Partial<PrivacyPrefs> = {};
  const src = input as Record<string, unknown>;
  for (const k of PRIVACY_KEYS) {
    // Enum keys are handled explicitly below; skip them in the boolean loop.
    if (k === "duel_from" || k === "friend_request_from") continue;
    const v = src[k];
    if (typeof v === "boolean") (out as Record<string, unknown>)[k] = v;
  }
  if (src.duel_from === "everyone" || src.duel_from === "nobody") {
    out.duel_from = src.duel_from;
  }
  // Settings overhaul 2026-06-11: friend_request_from is an everyone|nobody enum.
  if (src.friend_request_from === "everyone" || src.friend_request_from === "nobody") {
    out.friend_request_from = src.friend_request_from;
  }
  return out;
}

// Settings overhaul 2026-06-11: per-item EMAIL toggle map. Only known
// notification keys (NOTIF_KEYS) with boolean values are accepted.
function sanitizeNotificationsEmail(input: unknown): Partial<NotificationPrefs> {
  if (!input || typeof input !== "object") return {};
  const out: Partial<NotificationPrefs> = {};
  for (const k of NOTIF_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  // Read prefs + the top-level visibility column in one round-trip so the
  // client gets a consistent snapshot.
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("preferences, profile_visibility")
    .eq("id", auth.userId)
    .single();

  if (error) {
    console.error("[api/user/preferences GET]", error.message);
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }

  const stored = (data?.preferences ?? {}) as Partial<UserPreferences>;
  return NextResponse.json({
    notifications: { ...DEFAULT_NOTIFICATION_PREFS, ...(stored.notifications ?? {}) },
    privacy:       { ...DEFAULT_PRIVACY_PREFS,      ...(stored.privacy      ?? {}) },
    profile_visibility: (data?.profile_visibility as string | null) ?? "public",
    // Settings overhaul 2026-06-11: surface the new top-level prefs.
    notifications_email: { ...DEFAULT_NOTIFICATIONS_EMAIL, ...(stored.notifications_email ?? {}) },
    quiet_hours_enabled: stored.quiet_hours_enabled ?? false,
    quiet_hours_start: stored.quiet_hours_start ?? "22:00",
    quiet_hours_end: stored.quiet_hours_end ?? "08:00",
    last_export_at: stored.last_export_at ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: {
    notifications?: unknown;
    privacy?: unknown;
    notifications_email?: unknown;
    quiet_hours_enabled?: unknown;
    quiet_hours_start?: unknown;
    quiet_hours_end?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cleanNotifs  = sanitizeNotifications(body.notifications);
  const cleanPrivacy = sanitizePrivacy(body.privacy);
  const cleanEmail   = sanitizeNotificationsEmail(body.notifications_email);

  // Settings overhaul 2026-06-11: quiet-hours scalars. last_export_at is
  // intentionally NOT read here — it's written only by the export route.
  const qhEnabled = typeof body.quiet_hours_enabled === "boolean" ? body.quiet_hours_enabled : undefined;
  const qhStart   = isHHMM(body.quiet_hours_start) ? body.quiet_hours_start : undefined;
  const qhEnd     = isHHMM(body.quiet_hours_end) ? body.quiet_hours_end : undefined;

  const hasQuietHours = qhEnabled !== undefined || qhStart !== undefined || qhEnd !== undefined;

  if (
    Object.keys(cleanNotifs).length === 0 &&
    Object.keys(cleanPrivacy).length === 0 &&
    Object.keys(cleanEmail).length === 0 &&
    !hasQuietHours
  ) {
    return NextResponse.json({ error: "No valid preferences to update" }, { status: 400 });
  }

  // Read-modify-write with deep merge so we never blow away an
  // un-touched sub-blob. (lib/db.ts:updatePreferences already does
  // this, but we can't call client-side supabase from a route handler —
  // duplicate the deep-merge here against supabaseAdmin.)
  const { data: current, error: readErr } = await supabaseAdmin
    .from("profiles")
    .select("preferences")
    .eq("id", auth.userId)
    .single();

  if (readErr) {
    console.error("[api/user/preferences PATCH read]", readErr.message);
    return NextResponse.json({ error: "Failed to load current preferences" }, { status: 500 });
  }

  const stored = (current?.preferences ?? {}) as Partial<UserPreferences>;
  const mergedNotifs = {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...(stored.notifications ?? {}),
    ...cleanNotifs,
  };
  const mergedPrivacy = {
    ...DEFAULT_PRIVACY_PREFS,
    ...(stored.privacy ?? {}),
    ...cleanPrivacy,
  };
  // Settings overhaul 2026-06-11: per-item email map. weekly_report defaults
  // email-on; everything else is opt-in.
  const mergedEmail = {
    ...DEFAULT_NOTIFICATIONS_EMAIL,
    ...(stored.notifications_email ?? {}),
    ...cleanEmail,
  };

  const nextPrefs: Partial<UserPreferences> = {
    ...stored,
    notifications: mergedNotifs,
    privacy: mergedPrivacy,
    notifications_email: mergedEmail,
    quiet_hours_enabled: qhEnabled ?? stored.quiet_hours_enabled ?? false,
    quiet_hours_start: qhStart ?? stored.quiet_hours_start ?? "22:00",
    quiet_hours_end: qhEnd ?? stored.quiet_hours_end ?? "08:00",
  };

  const { error: writeErr } = await supabaseAdmin
    .from("profiles")
    .update({ preferences: nextPrefs })
    .eq("id", auth.userId);

  if (writeErr) {
    console.error("[api/user/preferences PATCH write]", writeErr.message);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  return NextResponse.json({
    notifications: mergedNotifs,
    privacy: mergedPrivacy,
    notifications_email: mergedEmail,
    quiet_hours_enabled: nextPrefs.quiet_hours_enabled,
    quiet_hours_start: nextPrefs.quiet_hours_start,
    quiet_hours_end: nextPrefs.quiet_hours_end,
  });
}
