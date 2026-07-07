"use client";

import { useEffect, useRef, useState } from "react";
import { MusicNotes, X, Pause, Play, ArrowsClockwise, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import {
  useOpenLauncherPanel,
  useCloseLauncherPanel,
  closeLauncherPanel,
} from "@/lib/launcher-bus";

/**
 * Focus Music — small floating audio player.
 *
 * Three curated free-streaming lo-fi/focus loops (YouTube embeds with
 * autoplay). User toggles the panel open from a navbar/floating button,
 * picks a vibe, plays/pauses, can swap stations.
 *
 * Implementation notes:
 *   - We use a hidden <iframe> for playback (YouTube IFrame API would let
 *     us control play/pause from JS, but adding it is heavyweight). For
 *     v0 we mount/unmount the iframe to start/stop and let the embed's
 *     own controls handle the rest.
 *   - State persists across navigation via window-scoped state — once you
 *     start a station it keeps playing until you close the player or
 *     unload the tab.
 *   - This is a vibe feature, not a core flow. Hidden on screens narrower
 *     than `sm` to avoid crowding mobile.
 */

// NOTE on playback: these are YouTube IFrame embeds. Two things matter for
// audio to actually start:
//   1. The iframe must NOT be display:none (browsers refuse to play audio from
//      a display:none iframe). We render it off-screen but "displayed" instead.
//   2. autoplay needs a user gesture — clicking a station IS that gesture, so
//      the embed is allowed to start with sound.
// `playsinline=1` + `rel=0` keep mobile + suggestions sane.
// `enablejsapi=1` lets us subscribe to the widget's postMessage events
// (onStateChange / onError), so the panel reflects REAL playback state instead
// of trusting local click state. A dead / non-embeddable / geo-blocked ID now
// surfaces an honest error row instead of a silent fake "playing" UI.
const EMBED = (id: string) =>
  `https://www.youtube.com/embed/${id}?autoplay=1&controls=0&modestbranding=1&playsinline=1&rel=0&enablejsapi=1`;

const STATIONS = [
  {
    id: "lofi-girl",
    label: "Lo-fi to study",
    description: "Chill beats to focus to.",
    // Was the Lofi Girl 24/7 LIVESTREAM (jfKfPfyJRdk) — YouTube livestreams
    // refuse embed-autoplay, which is why this one never played while the
    // other (regular-video) stations did. Swapped to a normal lofi mix.
    // A non-embeddable ID now surfaces as an error row at runtime (widget
    // onError / start watchdog) instead of failing silently — swap the ID
    // for any regular (non-live) lofi video if users hit the error state.
    src: EMBED("lTRiuFIWV54"),
  },
  {
    id: "tropical-rain",
    label: "Tropical rain",
    description: "Warm rain on leaves. Calm and cozy.",
    src: EMBED("yIQd2Ya0Ziw"),
  },
  {
    id: "deep-focus",
    label: "Deep focus",
    description: "Ambient + light beats for hard work.",
    src: EMBED("7NOSDKb0HlU"),
  },
] as const;

type StationId = typeof STATIONS[number]["id"];

// Real playback status, driven by the YouTube widget's postMessage events:
//   loading — station picked, stream not confirmed playing yet
//   playing — the widget reported playerState 1 (audio is actually flowing)
//   error   — the widget reported onError, or playback never started in time
type PlaybackStatus = "loading" | "playing" | "error";

// If the widget never reports "playing" within this window (non-embeddable
// video, region block, blocked autoplay, dead ID), flip to an honest error
// state instead of showing a permanent fake "playing" row.
const PLAYBACK_TIMEOUT_MS = 12_000;

const STORAGE_KEY = "lionade-focus-music";

interface PersistedState {
  station: StationId | null;
  open: boolean;
}

export default function FocusMusicToggle() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [station, setStation] = useState<StationId | null>(null);
  const [playback, setPlayback] = useState<PlaybackStatus>("loading");
  // Bumped to re-mount the iframe on "tap to retry" after an error.
  const [attempt, setAttempt] = useState(0);
  const audioContainerRef = useRef<HTMLDivElement>(null);

  // ── LaunchDock integration ──
  useOpenLauncherPanel("music", () => setOpen(true));
  useCloseLauncherPanel("music", () => setOpen(false));
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) closeLauncherPanel("music");
    wasOpenRef.current = open;
  }, [open]);

  // useAuth seeds `user` from localStorage on the client, so SSR renders
  // null and the first client render can render the button — that's a
  // hydration mismatch. Defer auth-driven render until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Restore last station + panel state on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState;
        if (parsed.station && STATIONS.some(s => s.id === parsed.station)) {
          setStation(parsed.station);
        }
        if (parsed.open) setOpen(true);
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ station, open }));
    } catch { /* ignore */ }
  }, [station, open]);

  // Click outside the panel (and outside the trigger) closes it. The panel
  // and trigger both carry data-focus-music so we can tell "inside" from a
  // genuine outside click. Music keeps playing — closing only hides the box.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest("[data-focus-music]")) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // ── Real playback feedback ──
  // Listen for the widget's postMessage events while a station is mounted.
  // playerState 1 = actually playing; onError = the video can't play here.
  useEffect(() => {
    if (!station) return;
    setPlayback("loading");

    const onMsg = (e: MessageEvent) => {
      if (e.origin !== "https://www.youtube.com") return;
      let data: unknown = e.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return; }
      }
      const msg = data as { event?: string; info?: unknown };
      if (msg.event === "onError") { setPlayback("error"); return; }
      if (msg.event === "onStateChange" && msg.info === 1) { setPlayback("playing"); return; }
      if (
        msg.event === "infoDelivery" &&
        typeof msg.info === "object" && msg.info !== null &&
        (msg.info as { playerState?: number }).playerState === 1
      ) {
        setPlayback("playing");
      }
    };
    window.addEventListener("message", onMsg);

    // Watchdog: no "playing" signal in time means the stream never started.
    const timer = setTimeout(() => {
      setPlayback((p) => (p === "playing" ? p : "error"));
    }, PLAYBACK_TIMEOUT_MS);

    return () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
    };
  }, [station, attempt]);

  // Once the iframe loads, subscribe to the widget's event stream (the
  // "listening" handshake is how the embed knows to start posting events).
  const handleIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const win = e.currentTarget.contentWindow;
    if (!win) return;
    const post = (payload: Record<string, unknown>) =>
      win.postMessage(JSON.stringify(payload), "https://www.youtube.com");
    post({ event: "listening", id: "lionade-focus-music", channel: "widget" });
    post({ event: "command", func: "addEventListener", args: ["onStateChange"] });
    post({ event: "command", func: "addEventListener", args: ["onError"] });
  };

  const currentStation = STATIONS.find(s => s.id === station) ?? null;

  // Hide on signed-out marketing pages — this is a study-mode tool,
  // not a homepage attraction. Also gate on mount to keep SSR HTML and
  // first client render in sync.
  if (!mounted || !user?.id) return null;

  return (
    <>
      {/* Standalone trigger removed — opened via the LaunchDock at bottom-right. */}

      {/* Off-screen iframe for actual playback. We do NOT use display:none /
          `hidden` here — browsers block audio + autoplay from display:none
          iframes (this was why Lo-fi never started). Positioning it off the
          left edge keeps it "rendered" (so audio plays) while invisible.
          Re-mounts when station changes; unmounts when station is null. */}
      <div
        ref={audioContainerRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "-9999px",
          top: 0,
          width: 1,
          height: 1,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {currentStation && (
          <iframe
            key={`${currentStation.id}-${attempt}`}
            src={currentStation.src}
            allow="autoplay; encrypted-media"
            title={currentStation.label}
            width="320"
            height="180"
            onLoad={handleIframeLoad}
          />
        )}
      </div>

      {open && (
        <Panel
          station={station}
          playback={playback}
          // Toggle: tapping the station that's already playing stops it;
          // tapping a different one switches. (Tap-again-to-stop, per design.)
          // Exception: tapping an ERRORED station retries it (re-mounts the
          // iframe) instead of stopping a stream that never started.
          onPick={(s) => {
            if (s === station) {
              if (playback === "error") setAttempt((a) => a + 1);
              else setStation(null);
            } else {
              setStation(s);
            }
          }}
          onStop={() => setStation(null)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Panel({
  station, playback, onPick, onStop, onClose,
}: {
  station: StationId | null;
  playback: PlaybackStatus;
  onPick: (s: StationId) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  return (
    <div
      data-focus-music
      className="fixed z-30 right-4 md:right-6 bottom-[210px] md:bottom-[180px]
        w-[280px] rounded-[12px] border border-white/[0.1] bg-navy/95 backdrop-blur-md
        shadow-2xl shadow-black/40 p-4 animate-slide-up"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <MusicNotes size={13} className="text-[#A855F7]" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-[#A855F7]">
            Focus music
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid place-items-center w-6 h-6 rounded-full hover:bg-white/[0.06] text-cream/40 hover:text-cream"
        >
          <X size={11} weight="bold" />
        </button>
      </div>

      <ul className="flex flex-col gap-1.5 mb-3">
        {STATIONS.map(s => {
          const active = s.id === station;
          const failed = active && playback === "error";
          const starting = active && playback === "loading";
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s.id)}
                aria-label={
                  failed ? `${s.label} could not start. Tap to retry.`
                    : starting ? `${s.label}, starting`
                    : active ? `${s.label}, playing. Tap to stop.`
                    : `Play ${s.label}`
                }
                className={`
                  w-full text-left rounded-[8px] px-3 py-2 transition-colors
                  ${failed
                    ? "bg-red-500/[0.08] border border-red-400/40"
                    : active
                      ? "bg-[#A855F7]/[0.12] border border-[#A855F7]/40"
                      : "bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.12]"
                  }
                `}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="font-syne font-semibold text-[13px] text-cream">{s.label}</span>
                  {failed
                    ? <WarningCircle size={12} className="text-red-400 shrink-0" weight="fill" />
                    : starting
                      ? <CircleNotch size={11} className="text-cream/40 shrink-0 motion-safe:animate-spin" weight="bold" />
                      : active
                        ? <Pause size={11} className="text-[#A855F7] shrink-0" weight="fill" />
                        : <Play size={11} className="text-cream/30 shrink-0" weight="fill" />
                  }
                </div>
                <p className="text-[11px] text-cream/55 leading-snug">{s.description}</p>
                {failed && (
                  <p className="text-[10.5px] text-red-300/90 leading-snug mt-1" role="alert">
                    This station couldn&apos;t start. Tap to retry, or pick another.
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {station && (
        <button
          type="button"
          onClick={onStop}
          className="w-full inline-flex items-center justify-center gap-1.5
            rounded-full border border-white/[0.1] hover:border-white/[0.25]
            font-mono text-[10px] uppercase tracking-[0.25em] text-cream/70 hover:text-cream
            py-2 transition-colors"
        >
          <ArrowsClockwise size={11} weight="bold" />
          Stop music
        </button>
      )}

      <p className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-cream/30 text-center mt-3">
        Streams live YouTube · audio only
      </p>
    </div>
  );
}

// (Standalone FocusMusicTrigger pill was deleted when the bottom-right surface
//  was consolidated under LaunchDock. The Panel below is the only remaining
//  UI; it opens via the dock or the launcher-bus open event.)
