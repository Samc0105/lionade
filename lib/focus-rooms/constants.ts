// Focus Rooms — shared constants (server + client safe: no imports).
//
// The reward table is deliberately IDENTICAL to solo Focus Lock-In
// (app/api/focus-session/route.ts) so a room session never out-earns or
// under-earns a solo one; the only extra money is the +15 group bonus when
// two or more members finish the same session.

export const FOCUS_ROOM_DURATIONS = [25, 45, 60] as const;
export type FocusRoomDuration = (typeof FOCUS_ROOM_DURATIONS)[number];

export const FANGS_BY_DURATION: Record<FocusRoomDuration, number> = {
  25: 25,
  45: 50,
  60: 75,
};

/** Flat group bonus per member when >= 2 members complete the session. */
export const GROUP_BONUS_FANGS = 15;

/**
 * Shared daily cap with solo Focus Lock-In. BOTH ledger types count toward
 * the same 6/day so rooms can't be used to sidestep the solo cap.
 */
export const MAX_FOCUS_SESSIONS_PER_DAY = 6;
export const FOCUS_CAP_LEDGER_TYPES = ["focus_session", "focus_room_bonus"];

/**
 * Clock-drift tolerance on /complete: a completion is accepted once the
 * SERVER clock is within this many ms of ends_at. Client timers derive from
 * the server ends_at + a measured skew, so 20s comfortably covers jitter
 * without letting anyone shave meaningful time off a 25+ minute session.
 */
export const COMPLETE_GRACE_MS = 20_000;

/** Room capacity. Body-doubling, not a stadium. */
export const MAX_ROOM_MEMBERS = 8;

export const FOCUS_PRIVACY_MODES = ["open", "friends", "closed"] as const;
export type FocusRoomPrivacy = (typeof FOCUS_PRIVACY_MODES)[number];

export type FocusRoomStatus = "lobby" | "running" | "done" | "expired";
