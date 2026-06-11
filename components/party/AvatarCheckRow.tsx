"use client";

// AvatarCheckRow — "who's done" roster used across the party games.
//
// Bluff Trivia uses it for the write phase (submitted) and the vote phase
// (voted); Trivia (Lightning Round) uses it for the answer phase (locked in).
// Driven purely by ids-only arrays from the phase-aware GET, so it can never
// leak content. Done players get a gold ring + checkmark badge; pending
// players stay dim. Extracted from BluffView.tsx (2026-06-11) so siblings can
// share it without re-declaring it.

import type { PartyPlayer } from "@/lib/party/types";

// Same dicebear style the party views use for presenter/roster avatars; seed =
// username so the avatar is stable across rounds without any profile fetch.
function avatarSrcFor(username: string | null | undefined): string {
  const seed = username && username.length > 0 ? username : "player";
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

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
            className="relative inline-flex"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarSrcFor(p.username)}
              alt={`${name}, ${done ? doneTitle : pendingTitle}`}
              className="w-8 h-8 rounded-full bg-navy object-cover transition-all"
              style={{
                border: done
                  ? "2px solid rgba(255,215,0,0.75)"
                  : isMe
                    ? "2px solid rgba(168,85,247,0.55)"
                    : "1px solid rgba(255,255,255,0.14)",
                boxShadow: done ? "0 0 8px rgba(255,215,0,0.4)" : "none",
                opacity: done ? 1 : 0.5,
              }}
            />
            {done && (
              <span
                aria-hidden="true"
                className={`absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ${reduced ? "" : "pa-chip-in"}`}
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
