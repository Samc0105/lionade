"use client";

// Arena V2 — opponent identity strip for a ghost match.
//
// Display rules (from project_arena_v2_decisions.md):
//   - Default: show anonymized handle ("Shadow Wolf 4729") + neutral avatar.
//   - Adults who opted-in (ghost_show_username = true): show real username.
//   - Under-18 viewers: ALWAYS see anonymized handle, regardless of the
//     ghost owner's opt-in. The viewer's birthdate gates this — passed in
//     as `viewerIsAdult`.
//   - Trainer Ninny: shows a distinct labeled badge + Ninny-blue avatar.
//     "TRAINER" badge above the avatar. Never disguised as a human.
//
// The component is purely presentational. The page resolves the handle +
// flags from the API response and the viewer's profile.

import { cdnUrl } from "@/lib/cdn";

interface GhostIdentityProps {
  /** "TRAINER" / "LIVE" / "MISMATCH" / null */
  badge?: string | null;
  /** Anonymized handle (always present). */
  anonHandle: string;
  /** Real username (if shown). */
  realUsername?: string | null;
  /** Real avatar URL (only used if realUsername is shown). */
  realAvatarUrl?: string | null;
  /** Is the ghost a Trainer Ninny? Overrides everything else. */
  isTrainer?: boolean;
  /** Owner opted in to show real username. */
  ownerOptedIn?: boolean;
  /** Viewer is 18+. Under-18 viewers always see anonymized. */
  viewerIsAdult?: boolean;
  /** Opponent's ELO at recording (shown under the handle). */
  elo?: number | null;
  /** Alignment — flips for right-side opponent layouts. */
  align?: "left" | "right";
}

export default function GhostIdentity({
  badge,
  anonHandle,
  realUsername,
  realAvatarUrl,
  isTrainer = false,
  ownerOptedIn = false,
  viewerIsAdult = false,
  elo,
  align = "left",
}: GhostIdentityProps) {
  const showReal = !isTrainer && ownerOptedIn && viewerIsAdult && !!realUsername;
  const displayName = showReal ? realUsername! : anonHandle;

  return (
    <div className={`flex items-center gap-3 ${align === "right" ? "flex-row-reverse" : ""}`}>
      <div className="relative">
        {isTrainer ? (
          <div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center"
            style={{
              background: "radial-gradient(circle, #3B82F6 0%, #1E40AF 100%)",
              boxShadow: "0 0 25px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
              border: "2px solid rgba(147,197,253,0.5)",
            }}
            aria-label="Trainer Ninny avatar"
          >
            <img src={cdnUrl("/F.png")} alt="" className="w-7 h-7 object-contain opacity-90" />
          </div>
        ) : showReal && realAvatarUrl ? (
          <img
            src={realAvatarUrl}
            alt={`${displayName} avatar`}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover"
            style={{ border: "2px solid rgba(168,85,247,0.4)" }}
          />
        ) : (
          // Neutral anonymized avatar — purple monogram circle.
          <div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center font-bebas text-xl tracking-wider"
            style={{
              background: "linear-gradient(135deg, #6B21A8 0%, #3B0764 100%)",
              border: "2px solid rgba(168,85,247,0.5)",
              boxShadow: "0 0 15px rgba(168,85,247,0.2)",
              color: "rgba(238,244,255,0.85)",
            }}
            aria-label={`${displayName} anonymized avatar`}
          >
            {anonHandle.split(" ").slice(0, 2).map(w => w[0]).join("")}
          </div>
        )}
        {badge && (
          <span
            className="absolute -top-2 left-1/2 -translate-x-1/2 font-bebas text-[9px] tracking-[0.2em] px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{
              background: isTrainer ? "#1E40AF" : "rgba(184,150,12,0.95)",
              color: isTrainer ? "rgba(238,244,255,0.95)" : "#04080F",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
        <p className="font-syne font-bold text-sm sm:text-base text-cream truncate max-w-[160px]">{displayName}</p>
        {elo != null && (
          <p className="text-cream/40 text-xs font-bebas tracking-wider">{elo} ELO</p>
        )}
        {isTrainer && (
          <p className="text-blue-300/70 text-[10px] font-syne italic mt-0.5 max-w-[180px] leading-tight">
            Real challengers unlock after 3 duels or 24h.
          </p>
        )}
      </div>
    </div>
  );
}
