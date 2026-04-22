import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * Nudges — one-tap encouragement between friends.
 *
 * POST: send a nudge. Enforces:
 *   - Only accepted friends (looks up friendships)
 *   - Fixed preset messages (no user-generated text)
 *   - Max 5 per sender per day
 *   - Max 1 per (sender, recipient) per day
 * Side effect: writes a notifications row so the recipient sees it.
 *
 * GET: returns how many nudges the caller has left today +
 *      which friend-ids they've already nudged today (so the UI can
 *      disable their buttons).
 */

const DAILY_LIMIT = 5;

const PRESETS = {
  grind:      "🔥 grind time — let's go",
  gotthis:    "you got this, stay locked in",
  studyup:    "we studying? hop on",
  missyou:    "miss your grind — pull up",
} as const;

type PresetKey = keyof typeof PRESETS;

function startOfDayUtc(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — caller's nudge budget for today + who they've already nudged
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: todays } = await supabaseAdmin
      .from("nudges")
      .select("recipient_id")
      .eq("sender_id", userId)
      .gte("created_at", startOfDayUtc());

    const nudgedToday: string[] = (todays ?? []).map(r => r.recipient_id);
    const remaining = Math.max(0, DAILY_LIMIT - nudgedToday.length);

    return NextResponse.json({
      remaining,
      limit: DAILY_LIMIT,
      nudgedToday,
    });
  } catch (err) {
    console.error("[social/nudge GET]", err);
    return NextResponse.json({ remaining: DAILY_LIMIT, limit: DAILY_LIMIT, nudgedToday: [] });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — send a nudge
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const senderId = auth.userId;

  try {
    const body = await req.json();
    const recipientId = typeof body?.recipientId === "string" ? body.recipientId : null;
    const preset = typeof body?.preset === "string" ? body.preset : null;

    if (!recipientId) return NextResponse.json({ error: "recipientId required" }, { status: 400 });
    if (!preset || !(preset in PRESETS)) {
      return NextResponse.json({ error: "invalid preset" }, { status: 400 });
    }
    if (recipientId === senderId) {
      return NextResponse.json({ error: "can't nudge yourself" }, { status: 400 });
    }

    // Must be accepted friends
    const { data: friendship } = await supabaseAdmin
      .from("friendships")
      .select("id, status, user_id, friend_id")
      .or(`and(user_id.eq.${senderId},friend_id.eq.${recipientId}),and(user_id.eq.${recipientId},friend_id.eq.${senderId})`)
      .eq("status", "accepted")
      .maybeSingle();

    if (!friendship) {
      return NextResponse.json({ error: "not friends" }, { status: 403 });
    }

    // Check daily budget + per-pair limit
    const { data: todays } = await supabaseAdmin
      .from("nudges")
      .select("recipient_id")
      .eq("sender_id", senderId)
      .gte("created_at", startOfDayUtc());

    const count = todays?.length ?? 0;
    if (count >= DAILY_LIMIT) {
      return NextResponse.json({ error: "daily nudge limit reached" }, { status: 429 });
    }
    if (todays?.some(r => r.recipient_id === recipientId)) {
      return NextResponse.json({ error: "already nudged this friend today" }, { status: 429 });
    }

    // Insert nudge row
    const { data: nudge, error: nudgeErr } = await supabaseAdmin
      .from("nudges")
      .insert({ sender_id: senderId, recipient_id: recipientId, preset })
      .select("id")
      .single();

    if (nudgeErr || !nudge) {
      console.error("[social/nudge POST] insert:", nudgeErr?.message);
      return NextResponse.json({ error: "Failed to record nudge" }, { status: 500 });
    }

    // Fire a notification to the recipient (best-effort)
    try {
      const { data: senderProfile } = await supabaseAdmin
        .from("profiles").select("username").eq("id", senderId).single();
      const message = PRESETS[preset as PresetKey];
      await supabaseAdmin.from("notifications").insert({
        user_id: recipientId,
        type: "nudge",
        title: `${senderProfile?.username ?? "A friend"} nudged you`,
        message,
        action_url: "/social",
        related_user_id: senderId,
      });
    } catch {
      /* notifications table optional */
    }

    return NextResponse.json({
      ok: true,
      nudgeId: nudge.id,
      remaining: Math.max(0, DAILY_LIMIT - count - 1),
    });
  } catch (err) {
    console.error("[social/nudge POST]", err);
    return NextResponse.json({ error: "Unknown error" }, { status: 500 });
  }
}
