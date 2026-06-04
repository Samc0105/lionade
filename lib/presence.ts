// Session lifecycle helpers — fire-and-forget wrappers around the
// `set_active_session` / `clear_active_session` Postgres RPCs.
//
// Used by every JOIN/LEAVE entry point so the server knows exactly what
// session (party room, arena match, mastery session, etc.) each user is
// currently engaged with. The AFK reaper (/api/cron/reap-afk-presence)
// will clear stale rows when a user disappears without explicitly leaving.
//
// CONTRACT (see dev-database migration shipping in parallel):
//   set_active_session(p_user_id uuid, p_type text, p_id text, p_role text)
//   clear_active_session(p_user_id uuid)
//
// Both helpers SWALLOW errors by design. Active-session bookkeeping is
// metadata — it must NEVER block the user-facing response. We log warnings
// for ops visibility but never propagate.

import { supabaseAdmin } from "./supabase-server";

/** Valid `type` values for active_session. Keep in sync with the migration. */
export type ActiveSessionType =
  | "party_room"
  | "arena_match"
  | "competitive_match"
  | "mastery_session"
  | "daily_drill"
  | "quiz";

/**
 * Mark the user as actively engaged in a session.
 * Fire-and-forget — callers should NOT await the response on the
 * user-facing critical path. Wrap in `void` for clarity at the callsite.
 */
export async function setActiveSession(
  userId: string,
  type: ActiveSessionType,
  id: string,
  role: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("set_active_session", {
      p_user_id: userId,
      p_type: type,
      p_id: id,
      p_role: role,
    });
    if (error) {
      console.warn("[presence] set_active_session WARN:", error.message);
    }
  } catch (err) {
    console.warn("[presence] set_active_session threw:", err);
  }
}

/**
 * Clear the user's active_session. Called by LEAVE entry points + session
 * completion routes (mastery complete, daily-drill complete, quiz complete).
 * Idempotent on the DB side (clearing a NULL is a no-op).
 */
export async function clearActiveSession(userId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("clear_active_session", {
      p_user_id: userId,
    });
    if (error) {
      console.warn("[presence] clear_active_session WARN:", error.message);
    }
  } catch (err) {
    console.warn("[presence] clear_active_session threw:", err);
  }
}
