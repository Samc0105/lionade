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
//
// CONNECTIVITY (2026-06): the shell ALSO owns the match-screen connectivity UI
// so the four mode screens stay focused on gameplay. The shell opens its OWN
// read-only subscription to the match channel (same stable channel name; a
// second client subscription is fine — presence track() is idempotent per key)
// and surfaces:
//   1. own-connection "Reconnecting…" banner (connection === "reconnecting")
//   2. opponent-disconnected panel after a grace window (Wait / End match)
//   3. an explicit Forfeit affordance + a "leaving may forfeit" Exit warning
// The shell drives /complete (End match an opponent abandoned → settle or void)
// and /forfeit (the present player quits → forfeit-loss or void) via useSettle,
// and renders the resulting outcome over the whole play surface.

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import { apiGet } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { useHeartbeat } from "@/lib/use-heartbeat";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import { useSettle } from "@/components/competitive/useSettle";
import ResultCard from "@/components/competitive/ResultCard";
import { isCompetitiveMode, type CompetitiveMatchRow, type CompetitiveMode } from "@/lib/competitive/types";

// Only one mode screen renders per match, so we code-split them: each mode's
// gameplay loop (and PinScreen's internal Leaflet lazy-load) only ships when
// that mode is actually played. ssr:false because these are fully client-side
// realtime surfaces — there's nothing meaningful to render server-side.
type ModeScreenProps = { loaded: LoadedMatch; selfId: string };
const MODE_SCREENS: Record<CompetitiveMode, React.ComponentType<ModeScreenProps>> = {
  sabotage: dynamic(() => import("@/components/competitive/sabotage/SabotageScreen"), { ssr: false }),
  zoom: dynamic(() => import("@/components/competitive/zoom/ZoomScreen"), { ssr: false }),
  spectrum: dynamic(() => import("@/components/competitive/spectrum/SpectrumScreen"), { ssr: false }),
  pin: dynamic(() => import("@/components/competitive/pin/PinScreen"), { ssr: false }),
};

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

// How long the opponent must be absent before we surface the disconnect panel.
// Short enough to feel responsive, long enough to ride out a brief WS blip /
// presence-leave-then-rejoin without nagging the player.
const OPPONENT_GRACE_MS = 13_000;

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
    // Mode not statically known -> gate the parent Arena surface.
    return (
      <ProtectedRoute>
        <FeatureGate feature="compete.arena">
          <Shell mode="sabotage"><p className="text-cream/60">Unknown mode.</p></Shell>
        </FeatureGate>
      </ProtectedRoute>
    );
  }

  // Gate the live match view on the per-mode flag (e.g. "compete.arena.sabotage").
  // The dot-path chain auto-resolves the "compete.arena" + "compete" ancestors,
  // so maintenance on any of them replaces the surface for non-staff. `mode` is
  // narrowed to a CompetitiveMode by the isCompetitiveMode guard above.
  return (
    <ProtectedRoute>
      <FeatureGate feature={`compete.arena.${mode}`}>
      <Shell mode={mode} loaded={loaded} selfId={user?.id ?? null}>
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
        {!error && loaded && user && (() => {
          const ModeScreen = MODE_SCREENS[mode];
          return <ModeScreen loaded={loaded} selfId={user.id} />;
        })()}
      </Shell>
      </FeatureGate>
    </ProtectedRoute>
  );
}

/**
 * The shared full-screen game shell. A fixed, edge-to-edge takeover above the
 * global Navbar (z-50). Two ambient orbs in the mode accent + a faint vignette
 * give depth without boxing the content. Children are laid out as a flex column
 * that fills the viewport so each mode can pin its HUD/controls to the edges.
 *
 * When `loaded` + `selfId` are present the shell wires its own connectivity
 * layer (banner / opponent panel / forfeit prompt). Before that (loading /
 * error / unknown-mode) it renders a bare frame with a plain Exit.
 */
function Shell({
  mode,
  loaded,
  selfId,
  children,
}: {
  mode: CompetitiveMode;
  loaded?: LoadedMatch | null;
  selfId?: string | null;
  children: React.ReactNode;
}) {
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

  const matchId = loaded?.match.id ?? null;
  const teamA = loaded?.match.team_a ?? [];

  // The opponent team = whichever team does NOT contain self. Stable per match.
  const opponentIds = useMemo<string[]>(() => {
    if (!loaded || !selfId) return [];
    return loaded.match.team_a.includes(selfId) ? loaded.match.team_b : loaded.match.team_a;
  }, [loaded, selfId]);

  // The shell's OWN read-only channel subscription — only for connection +
  // presence. Gameplay sends/handlers stay in the mode screen's subscription.
  const { connection, opponentPresent, opponentLastSeen } = useMatchChannel(matchId, selfId ?? null, opponentIds);

  // The shell-initiated endings (End match / Forfeit). `result` here is the
  // shell's own outcome — when set it takes over the whole play surface.
  // `settleError` surfaces a failed /complete or /forfeit inline (instead of
  // the button silently re-enabling and looking like it did nothing).
  const { settle, forfeit, result, settling, error: settleError } = useSettle(matchId ?? "");

  // Focus-management refs for the two role="alertdialog" overlays. We mirror the
  // ConfirmModal pattern: trap Tab inside the panel, move focus to the SAFE
  // (non-destructive) button on open, restore focus to the trigger on close, and
  // let Escape fire the safe action (cancel). KEEP WAITING / KEEP PLAYING are the
  // safe buttons; END MATCH / FORFEIT are the destructive ones.
  const oppPanelRef = useRef<HTMLDivElement | null>(null);
  const oppSafeBtnRef = useRef<HTMLButtonElement | null>(null);
  const exitPanelRef = useRef<HTMLDivElement | null>(null);
  const exitSafeBtnRef = useRef<HTMLButtonElement | null>(null);

  // ── Opponent grace timer. We only treat the opponent as "gone" once they've
  // been absent for OPPONENT_GRACE_MS, measured from opponentLastSeen. A brief
  // presence blip never trips the panel. ──
  const [now, setNow] = useState(() => Date.now());
  const [exitPrompt, setExitPrompt] = useState(false);
  // "Keep waiting" snoozes the panel until this timestamp. While snoozed the
  // grace window is measured from here instead of opponentLastSeen, so the panel
  // re-surfaces after one more full grace window if they're still gone — and the
  // snooze auto-clears the moment they return (opponentPresent flips true).
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);

  // Has the opponent EVER been seen this session? If they never connected, an
  // absence is "never showed up" rather than "disconnected mid-match" — both
  // route to the same End-match action, but the copy differs.
  const opponentEverSeen = opponentLastSeen !== null;

  // Clear any snooze once the opponent is back, so a later drop starts fresh.
  useEffect(() => {
    if (opponentPresent && snoozeUntil !== null) setSnoozeUntil(null);
  }, [opponentPresent, snoozeUntil]);

  const oppGoneFor = opponentEverSeen && !opponentPresent ? now - (opponentLastSeen as number) : 0;
  const snoozed = snoozeUntil !== null && now < snoozeUntil;
  const showOpponentPanel =
    !result && opponentEverSeen && !opponentPresent && !snoozed && oppGoneFor >= OPPONENT_GRACE_MS;

  // Tick a 1s clock ONLY while we're waiting out the grace window or showing the
  // panel — no always-on interval. Stops the moment the opponent returns or a
  // result lands.
  const waitingOnOpponent = !result && opponentEverSeen && !opponentPresent;
  useEffect(() => {
    if (!waitingOnOpponent) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitingOnOpponent]);

  // Block the duplicate-WS-warning: once we have a result we don't warn on exit.
  const hasResult = !!result;

  // ── Exit / Forfeit handlers ──
  const plainExit = () => router.push("/compete/arena");

  const confirmForfeit = async () => {
    await forfeit(); // POST /forfeit → forfeited-loss (both played) or voided
    // Leave the prompt open on failure so the inline error + retry button show;
    // useSettle clears no result, so a re-press just retries.
  };

  // KEEP PLAYING — the safe action for the exit prompt (also fired by Escape).
  const cancelExit = () => setExitPrompt(false);

  const endAbandonedMatch = async () => {
    await settle(); // POST /complete → settle (both played enough) or voided
  };

  // KEEP WAITING — the safe action for the opponent panel (also fired by
  // Escape). Snoozes the panel for one more grace window.
  const keepWaiting = () => setSnoozeUntil(Date.now() + OPPONENT_GRACE_MS);

  // ── Dialog focus management (mirrors components/ConfirmModal.tsx) ──
  // Trap Tab within the open dialog + route Escape to the safe action. Only one
  // of the two overlays is ever open at a time, but we guard each independently.
  useEffect(() => {
    if (!showOpponentPanel && !exitPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      const panel = showOpponentPanel ? oppPanelRef.current : exitPanelRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        if (showOpponentPanel) keepWaiting();
        else cancelExit();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showOpponentPanel, exitPrompt]);

  // Move focus to the SAFE button on open + restore to the trigger on close.
  // rAF avoids a layout race with the entrance animation.
  useEffect(() => {
    if (!showOpponentPanel) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => oppSafeBtnRef.current?.focus());
    return () => { cancelAnimationFrame(id); restoreTo?.focus?.(); };
  }, [showOpponentPanel]);

  useEffect(() => {
    if (!exitPrompt) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => exitSafeBtnRef.current?.focus());
    return () => { cancelAnimationFrame(id); restoreTo?.focus?.(); };
  }, [exitPrompt]);

  const showConnectivity = !!matchId && !!selfId;

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

      {/* ── OWN-CONNECTION banner: slim, non-blocking, amber. GPU-only (opacity +
          transform via framer). Clears the instant we're "connected" again, so
          input is never permanently blocked. ── */}
      <AnimatePresence>
        {showConnectivity && connection === "reconnecting" && !hasResult && (
          <motion.div
            key="reconnect-banner"
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
            className="absolute top-0 left-0 right-0 z-40 pointer-events-none flex justify-center"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-syne
              bg-[#FF8C42]/15 text-[#FFC58A] border border-[#FF8C42]/30 backdrop-blur-md">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FF8C42] animate-pulse" />
              Reconnecting...
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating exit affordance — keyboard-focusable, always reachable. When
          connectivity is wired, Exit becomes a Forfeit-aware prompt; otherwise
          (loading / error) it's a plain return. */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 sm:px-6"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <button
          onClick={() => (showConnectivity && !hasResult ? setExitPrompt(true) : plainExit())}
          aria-label={showConnectivity && !hasResult ? "Leave or forfeit this match" : "Exit match and return to the Arena"}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-syne
            text-cream/70 hover:text-cream bg-black/35 backdrop-blur-md border border-cream/10
            transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
        >
          <span className="text-base leading-none">&larr;</span>
          <span>{showConnectivity && !hasResult ? "Forfeit" : "Exit"}</span>
        </button>
        <span className="font-bebas tracking-[0.25em] text-[11px] sm:text-xs uppercase px-2.5 py-1 rounded-full
          bg-black/30 backdrop-blur-md border border-cream/[0.06]"
          style={{ color: `${accent}cc` }}>
          {theme.label}
        </span>
      </div>

      {/* Play surface — fills the viewport below the floating exit bar. When the
          shell holds its own result (ended an abandoned match / forfeited) it
          REPLACES the mode screen with the outcome card. */}
      <div
        className="relative z-10 flex-1 min-h-0 flex flex-col w-full"
        style={{
          paddingTop: "max(3.5rem, calc(env(safe-area-inset-top) + 3.25rem))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        {result && selfId ? (
          <ResultCard result={result} selfId={selfId} teamA={teamA} />
        ) : (
          children
        )}
      </div>

      {/* ── OPPONENT-DISCONNECTED panel: clear, honest, two options. Centered
          modal-style overlay (does not unmount the mode screen behind it, so a
          returning opponent just dismisses it). ── */}
      <AnimatePresence>
        {showOpponentPanel && (
          <motion.div
            key="opponent-gone"
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.25 }}
            className="absolute inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: "rgba(4,6,13,0.72)", backdropFilter: "blur(6px)" }}
            role="alertdialog"
            aria-modal="true"
            aria-label="Opponent disconnected"
          >
            <motion.div
              ref={oppPanelRef}
              initial={reduce ? false : { scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 22 }}
              className="relative w-full max-w-md rounded-2xl p-7 text-center"
              style={{ background: "linear-gradient(135deg, #0c1020 0%, #060c18 100%)", border: `1px solid ${accent}40` }}
            >
              <p className="font-bebas text-3xl tracking-wider mb-2" style={{ color: accent }}>
                OPPONENT DISCONNECTED
              </p>
              <p className="text-cream/65 font-syne text-sm leading-relaxed mb-1">
                Your opponent dropped out of the match.
              </p>
              <p className="text-cream/40 font-dm-mono text-xs mb-6">
                Gone for {Math.floor(oppGoneFor / 1000)}s
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={endAbandonedMatch}
                  disabled={settling}
                  className="font-bebas tracking-wider px-6 py-2.5 rounded-xl btn-gold text-sm disabled:opacity-50"
                >
                  {settling ? "ENDING..." : "END MATCH"}
                </button>
                {/* "Wait" snoozes the panel for one more grace window. It
                    reappears if they're still gone, and clears for good the
                    moment they return (snooze auto-resets on presence). This is
                    the SAFE action — focused on open + fired by Escape. */}
                <button
                  ref={oppSafeBtnRef}
                  onClick={keepWaiting}
                  className="font-bebas tracking-wider px-6 py-2.5 rounded-xl btn-outline text-sm"
                >
                  KEEP WAITING
                </button>
              </div>
              {/* Failed /complete — surfaced inline so the re-enabled END MATCH
                  button doesn't look like it did nothing. */}
              {settleError && !settling && (
                <p className="text-red-400 font-syne text-xs leading-relaxed mt-4" role="alert">
                  {settleError}
                </p>
              )}
              <p className="text-cream/35 font-syne text-[11px] leading-relaxed mt-4">
                Ending now scores the match. If they never played a round, it
                voids with no rank change.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── EXIT / FORFEIT prompt: leaving an active match forfeits. We say so. ── */}
      <AnimatePresence>
        {exitPrompt && !hasResult && (
          <motion.div
            key="exit-prompt"
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="absolute inset-0 z-[55] flex items-center justify-center px-4"
            style={{ background: "rgba(4,6,13,0.72)", backdropFilter: "blur(6px)" }}
            role="alertdialog"
            aria-modal="true"
            aria-label="Forfeit match?"
          >
            <motion.div
              ref={exitPanelRef}
              initial={reduce ? false : { scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 22 }}
              className="relative w-full max-w-md rounded-2xl p-7 text-center"
              style={{ background: "linear-gradient(135deg, #0c1020 0%, #060c18 100%)", border: "1px solid #EF444440" }}
            >
              <p className="font-bebas text-3xl tracking-wider mb-2 text-[#EF4444]">
                FORFEIT MATCH?
              </p>
              <p className="text-cream/65 font-syne text-sm leading-relaxed mb-6">
                Leaving now forfeits the match and counts as a loss. If your
                opponent never played, it voids instead with no rank change.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={confirmForfeit}
                  disabled={settling}
                  className="font-bebas tracking-wider px-6 py-2.5 rounded-xl text-sm bg-[#EF4444] text-navy
                    hover:bg-[#EF4444]/90 transition-colors disabled:opacity-50"
                >
                  {settling ? "FORFEITING..." : "FORFEIT & LEAVE"}
                </button>
                {/* KEEP PLAYING — the SAFE action: focused on open + fired by Escape. */}
                <button
                  ref={exitSafeBtnRef}
                  onClick={cancelExit}
                  className="font-bebas tracking-wider px-6 py-2.5 rounded-xl btn-outline text-sm"
                >
                  KEEP PLAYING
                </button>
              </div>
              {/* Failed /forfeit — surfaced inline so the re-enabled FORFEIT
                  button doesn't look like it did nothing. */}
              {settleError && !settling && (
                <p className="text-red-400 font-syne text-xs leading-relaxed mt-4" role="alert">
                  {settleError}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
