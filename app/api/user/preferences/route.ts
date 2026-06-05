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
];

const PRIVACY_KEYS: ReadonlyArray<keyof PrivacyPrefs> = [
  "show_on_leaderboard",
  "show_streak",
  "show_coins",
  "duel_from",
];

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
    if (k === "duel_from") continue;
    const v = src[k];
    if (typeof v === "boolean") (out as Record<string, unknown>)[k] = v;
  }
  if (src.duel_from === "everyone" || src.duel_from === "nobody") {
    out.duel_from = src.duel_from;
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
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: { notifications?: unknown; privacy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cleanNotifs  = sanitizeNotifications(body.notifications);
  const cleanPrivacy = sanitizePrivacy(body.privacy);

  if (Object.keys(cleanNotifs).length === 0 && Object.keys(cleanPrivacy).length === 0) {
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

  const nextPrefs = {
    ...stored,
    notifications: mergedNotifs,
    privacy: mergedPrivacy,
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
  });
}
