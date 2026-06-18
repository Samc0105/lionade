"use client";

// AvatarCheckRow — "who's done" roster used across the party games.
//
// Bluff Trivia uses it for the write phase (submitted) and the vote phase
// (voted); Trivia (Lightning Round) uses it for the answer phase (locked in).
// Driven purely by ids-only arrays from the phase-aware GET, so it can never
// leak content. Done players get a gold ring + checkmark badge; pending
// players stay dim. Extracted from BluffView.tsx (2026-06-11) so siblings can
// share it without re-declaring it.
//
// Shop V2: each avatar now renders the player's equipped frame + aura via the
// shared Avatar component. The functional done/me state ring + checkmark stay
// on a SEPARATE outer layer so an equipped cosmetic frame never masks game
// state.

import Avatar from "@/components/Avatar";
import { avatarFor } from "@/lib/avatar";
import type { PartyPlayer } from "@/lib/party/types";

export default function AvatarCheckRow({
  players,
  doneIds,
  meUserId,
  reduced,
  doneTitle,
  pendingTitle,
}: {
  players: PartyPlayer[];
  doneIds: string[];
  meUserId: string;
  reduced: boolean;
  doneTitle: string;
  pendingTitle: string;
}) {
  if (players.length === 0) return null;
  const doneSet = new Set(doneIds);
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {players.map((p) => {
        const done = doneSet.has(p.user_id);
        const isMe = p.user_id === meUserId;
        const name = p.username ?? "Player";
        return (
          <span
            key={p.user_id}
            title={`${name} · ${done ? doneTitle : pendingTitle}`}
            className="relative inline-flex rounded-full transition-all"
            style={{
              // Functional state ring on the OUTER wrapper, kept separate from
              // any equipped cosmetic frame so game state is never masked.
              boxShadow: done
                ? "0 0 0 2px rgba(255,215,0,0.75), 0 0 8px rgba(255,215,0,0.4)"
                : isMe
                  ? "0 0 0 2px rgba(168,85,247,0.55)"
                  : "0 0 0 1px rgba(255,255,255,0.14)",
              opacity: done ? 1 : 0.5,
            }}
          >
            <Avatar
              url={avatarFor(p.username, p.avatar_url)}
              alt={`${name}, ${done ? doneTitle : pendingTitle}`}
              size="sm"
              frame={p.equipped_frame}
              aura={p.equipped_avatar_aura}
            />
            {done && (
              <span
                aria-hidden="true"
                className={`absolute -bottom-0.5 -right-0.5 z-10 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ${reduced ? "" : "pa-chip-in"}`}
                style={{
                  background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                  border: "1px solid rgba(4,8,15,0.6)",
                }}
              >
                <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none" stroke="#04080F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 5.5 4 8l4.5-6" />
                </svg>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
