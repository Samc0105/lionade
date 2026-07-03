// Realtime channel name helpers for Focus Rooms.
//
// Follows the party naming convention (lib/party/realtime-channels.ts):
// one broadcast topic per room, created immediately on mount, plus a
// SEPARATE late-joining topic for the room_id-FILTERED postgres_changes
// feeds. The split matters: postgres_changes filters are fixed at join
// time and the room_id only resolves after the first snapshot — recreating
// the main topic to add the filter hits the supabase-js async-unsubscribe
// race that leaves the recreated channel permanently dead (see the
// roomPlayersChannel comment in the party helper).

export function focusRoomChannel(code: string): string {
  return `focus-room-${code}`;
}

/** Late-joining topic for postgres_changes on focus_rooms + focus_room_members. */
export function focusRoomChangesChannel(code: string): string {
  return `focus-room-${code}-changes`;
}

// ── Event name constants ──
// Server routes broadcast these best-effort (a broadcast failure never fails
// the request); the room page listens for all of them and refreshes its
// snapshot. The postgres_changes feeds + the 3s poll are the reconciler.
export const FOCUS_ROOM_EVENTS = {
  MEMBER_JOINED: "member_joined",
  MEMBER_LEFT: "member_left",
  SESSION_STARTED: "session_started",
  MEMBER_COMPLETED: "member_completed",
} as const;
