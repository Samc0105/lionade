// Tiny window-event bus for Lionade Party invites.
//
// The Navbar already holds the app's ONE postgres_changes subscription on the
// notifications table (channel `notifs-${user.id}`, INSERT filtered by
// user_id). Opening a second WebSocket subscription on the same table just to
// drive the global invite toast would double the Realtime connection cost and
// risk same-topic conflicts. Instead, the Navbar handler re-emits party_invite
// rows onto this bus (same pattern as lib/launcher-bus.ts) and
// PartyInviteToast listens — zero extra channels.
//
// The room code travels inside the notification row's `action_url`
// (`/games/party/<code>`) — the notifications table has no metadata column,
// and every insert site uses the fixed column set, so action_url is the
// canonical carrier. `fromNotificationRow` parses it defensively.
//
// SSR-safe: every API guards on `typeof window`.

import { useEffect, useRef } from "react";

export type PartyInviteDetail = {
  /** Notification row id — used to mark-as-read when the user taps Join. */
  notificationId: string;
  /** 4-digit numeric room code parsed from action_url. */
  code: string;
  /** Sender display name parsed from the notification title. */
  senderName: string;
};

const INVITE_EVENT = "lionade:party-invite";

// Title format is owned by app/api/party/rooms/[code]/invite-friend/route.ts:
// "<username> invited you to Lionade Party". Strip the fixed suffix to get
// the sender's name back out; fall back to a friendly generic.
const TITLE_SUFFIX_RE = /\s+invited you to Lionade Party$/;
const CODE_RE = /\/games\/party\/(\d{3,8})(?:[/?#]|$)/;

/** Build a PartyInviteDetail from a raw notifications INSERT payload row.
 *  Returns null when the row isn't a party_invite or lacks a parseable code. */
export function fromNotificationRow(row: unknown): PartyInviteDetail | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.type !== "party_invite") return null;
  const actionUrl = typeof r.action_url === "string" ? r.action_url : "";
  const m = actionUrl.match(CODE_RE);
  if (!m) return null;
  const title = typeof r.title === "string" ? r.title : "";
  const senderName = TITLE_SUFFIX_RE.test(title)
    ? title.replace(TITLE_SUFFIX_RE, "").trim() || "A friend"
    : "A friend";
  return {
    notificationId: typeof r.id === "string" ? r.id : String(r.id ?? ""),
    code: m[1],
    senderName,
  };
}

/** Fire an invite event for the global toast. No-op on the server. */
export function emitPartyInvite(detail: PartyInviteDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PartyInviteDetail>(INVITE_EVENT, { detail }),
  );
}

/** Subscribe to invite events. Handler is captured in a ref so the listener
 *  stays attached across renders (mirrors useOpenLauncherPanel). */
export function usePartyInvite(onInvite: (detail: PartyInviteDetail) => void): void {
  const ref = useRef(onInvite);
  useEffect(() => { ref.current = onInvite; }, [onInvite]);
  useEffect(() => {
    function handler(e: Event) {
      const ce = e as CustomEvent<PartyInviteDetail>;
      if (ce.detail?.code) ref.current(ce.detail);
    }
    window.addEventListener(INVITE_EVENT, handler);
    return () => window.removeEventListener(INVITE_EVENT, handler);
  }, []);
}
