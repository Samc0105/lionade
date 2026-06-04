"use client";

// Competitive Arena — per-match screen dispatcher.
//
// Route: /compete/arena/[mode]/[matchId]
// Loads the match state once, then renders the mode-specific screen component.
// Each mode component owns its own gameplay loop + realtime, and calls the
// shared /complete endpoint when the rounds are exhausted.
//
// LAYOUT: this is the shared FULL-SCREEN GAME SHELL. An active match is an
// immersive, edge-to-edge takeover that fills the entire viewport and sits
// ABOVE the global Navbar (which is fixed at z-50) so the game owns the whole
// screen — no centered card, no chrome eating the top. The only persistent
// chrome is a floating "Exit" pill (keyboard-focusable) so the player can
// always leave. Each mode tints the shell with its own accent.

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import { apiGet } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { useHeartbeat } from "@/lib/use-heartbeat";
import { isCompetitiveMode, type CompetitiveMatchRow, type CompetitiveMode } from "@/lib/competitive/types";
import SabotageScreen from "@/components/competitive/sabotage/SabotageScreen";
import ZoomScreen from "@/components/competitive/zoom/ZoomScreen";
import SpectrumScreen from "@/components/competitive/spectrum/SpectrumScreen";
import PinScreen from "@/components/competitive/pin/PinScreen";

export interface MatchPlayer {
  id: string;
  username: string;
  avatar_url: string | null;
  competitive_elo: number;
  squad_elo: number;
}

export interface LoadedMatch {
  match: CompetitiveMatchRow;
  rounds: Record<string, unknown>[];
  players: MatchPlayer[];
  you: string;
}

// Per-mode shell identity (accent + label) so the immersive frame glows in the
// mode's color. Mirrors the accents used on the arena hub cards.
const MODE_THEME: Record<CompetitiveMode, { accent: string; label: string }> = {
  sabotage: { accent: "#EF4444", label: "Sabotage Trivia" },
  zoom: { accent: "#00BFFF", label: "Zoom Reveal" },
  spectrum: { accent: "#A855F7", label: "Spectrum Slider" },
  pin: { accent: "#50C878", label: "Map Pin Drop" },
};

export default function CompetitiveMatchPage() {
  const params = useParams();
  const { user } = useAuth();
  const mode = String(params?.mode ?? "");
  const matchId = String(params?.matchId ?? "");
  const [loaded, setLoaded] = useState<LoadedMatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tier 1 lifecycle (Phase 1 — 2026-06-04). Heartbeat starts as soon as we
  // have a matchId in the URL — we don't wait for the full match-load
  // response because the user is committed to this match the moment the
  // page mounts.
  useHeartbeat(matchId ? "competitive_match" : null, matchId || null);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      const { ok, data, error: err } = await apiGet<LoadedMatch>(`/api/competitive/match/${matchId}`);
      if (cancelled) return;
      if (!ok || !data) {
        setError(err || "Could not load match");
        return;
      }
      setLoaded(data);
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  if (!isCompetitiveMode(mode)) {
    return (
      <ProtectedRoute>
        <Shell mode="sabotage"><p className="text-cream/60">Unknown mode.</p></Shell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <Shell mode={mode}>
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <p className="text-cream/70 mb-2">{error}</p>
            <p className="text-cream/40 text-sm">This match may have ended or you are not a participant.</p>
          </div>
        )}
        {!error && !loaded && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <span className="inline-block w-3 h-3 rounded-full bg-gold animate-pulse" />
            <p className="text-cream/50 mt-3 font-bebas tracking-wider">LOADING MATCH...</p>
          </div>
        )}
        {!error && loaded && user && (
          <>
            {mode === "sabotage" && <SabotageScreen loaded={loaded} selfId={user.id} />}
            {mode === "zoom" && <ZoomScreen loaded={loaded} selfId={user.id} />}
            {mode === "spectrum" && <SpectrumScreen loaded={loaded} selfId={user.id} />}
            {mode === "pin" && <PinScreen loaded={loaded} selfId={user.id} />}
          </>
        )}
      </Shell>
    </ProtectedRoute>
  );
}

/**
 * The shared full-screen game shell. A fixed, edge-to-edge takeover above the
 * global Navbar (z-50). Two ambient orbs in the mode accent + a faint vignette
 * give depth without boxing the content. Children are laid out as a flex column
 * that fills the viewport so each mode can pin its HUD/controls to the edges.
 */
function Shell({ mode, children }: { mode: CompetitiveMode; children: React.ReactNode }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const theme = MODE_THEME[mode];
  const accent = theme.accent;

  // Lock the page scroll behind the takeover while a match is open, so the
  // immersive frame truly owns the viewport.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const ambient = useMemo(() => ({
    one: `radial-gradient(circle, ${accent} 0%, transparent 70%)`,
    two: "radial-gradient(circle, #A855F7 0%, transparent 70%)",
  }), [accent]);

  return (
    <motion.div
      data-force-dark
      role="application"
      aria-label={`${theme.label} match`}
      initial={reduce ? false : { opacity: 0, scale: 0.965 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden"
      style={{
        isolation: "isolate",
        background: "radial-gradient(ellipse at 50% -10%, #0c1020 0%, #070b16 45%, #04060d 100%)",
      }}
    >
      {/* Accent light-sweep across the takeover on entry (runs once, then gone) */}
      {!reduce && (
        <div
          className="ca-light-sweep"
          style={{ "--ca-sweep": `${accent}24` } as React.CSSProperties & Record<string, string>}
        />
      )}

      {/* Ambient orbs in the mode accent — they fill the corners, not the center */}
      <div className="absolute top-[-10%] left-[-6%] w-[55vw] h-[55vw] max-w-[640px] max-h-[640px] rounded-full pointer-events-none opacity-[0.06]"
        style={{ background: ambient.one }} />
      <div className="absolute bottom-[-12%] right-[-8%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full pointer-events-none opacity-[0.05]"
        style={{ background: ambient.two }} />
      {/* Hairline top accent so the takeover reads as "in a match" */}
      <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}66, transparent)` }} />

      {/* Floating exit affordance — keyboard-focusable, always reachable */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 sm:px-6"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <button
          onClick={() => router.push("/compete/arena")}
          aria-label="Exit match and return to the Arena"
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-syne
            text-cream/70 hover:text-cream bg-black/35 backdrop-blur-md border border-cream/10
            transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
        >
          <span className="text-base leading-none">&larr;</span>
          <span>Exit</span>
        </button>
        <span className="font-bebas tracking-[0.25em] text-[11px] sm:text-xs uppercase px-2.5 py-1 rounded-full
          bg-black/30 backdrop-blur-md border border-cream/[0.06]"
          style={{ color: `${accent}cc` }}>
          {theme.label}
        </span>
      </div>

      {/* Play surface — fills the viewport below the floating exit bar */}
      <div
        className="relative z-10 flex-1 min-h-0 flex flex-col w-full"
        style={{
          paddingTop: "max(3.5rem, calc(env(safe-area-inset-top) + 3.25rem))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}
