"use client";

import { useEffect, useRef, useState } from "react";
import { MusicNotes, X, Pause, Play, Headphones, ArrowsClockwise } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { useIdleAttention } from "@/lib/use-idle-attention";

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

const STATIONS = [
  {
    id: "lofi-girl",
    label: "Lo-fi to study",
    description: "The classic. ChilledCow's 24/7 stream.",
    src: "https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1&controls=0&modestbranding=1",
  },
  {
    id: "deep-focus",
    label: "Deep focus",
    description: "Ambient + light beats for hard work.",
    src: "https://www.youtube.com/embed/7NOSDKb0HlU?autoplay=1&controls=0&modestbranding=1",
  },
] as const;

type StationId = typeof STATIONS[number]["id"];

const STORAGE_KEY = "lionade-focus-music";

interface PersistedState {
  station: StationId | null;
  open: boolean;
}

export default function FocusMusicToggle() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [station, setStation] = useState<StationId | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);

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

  const currentStation = STATIONS.find(s => s.id === station) ?? null;

  // Hide on signed-out marketing pages — this is a study-mode tool,
  // not a homepage attraction.
  if (!user?.id) return null;

  return (
    <>
      {/* Floating launcher — hidden on small screens so it doesn't fight
          the mobile bottom nav. Sits right above the QuickNote pill. */}
      <FocusMusicTrigger
        open={open}
        station={station}
        onToggle={() => setOpen(o => !o)}
      />

      {/* Hidden iframe for actual playback. Re-mounts when station changes;
          unmounts when station is null (= stopped). */}
      <div ref={audioContainerRef} className="hidden" aria-hidden="true">
        {currentStation && (
          <iframe
            key={currentStation.id}
            src={currentStation.src}
            allow="autoplay; encrypted-media"
            title={currentStation.label}
            width="0"
            height="0"
          />
        )}
      </div>

      {open && (
        <Panel
          station={station}
          onPick={(s) => setStation(s)}
          onStop={() => setStation(null)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Panel({
  station, onPick, onStop, onClose,
}: {
  station: StationId | null;
  onPick: (s: StationId) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  return (
    <div
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
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s.id)}
                className={`
                  w-full text-left rounded-[8px] px-3 py-2 transition-colors
                  ${active
                    ? "bg-[#A855F7]/[0.12] border border-[#A855F7]/40"
                    : "bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-white/[0.12]"
                  }
                `}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="font-syne font-semibold text-[13px] text-cream">{s.label}</span>
                  {active
                    ? <Pause size={11} className="text-[#A855F7] shrink-0" weight="fill" />
                    : <Play size={11} className="text-cream/30 shrink-0" weight="fill" />
                  }
                </div>
                <p className="text-[11px] text-cream/55 leading-snug">{s.description}</p>
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

// ─────────────────────────────────────────────────────────────────────────────
// Trigger pill — extracted so the idle-attention fade lives in its own scope
// without rebuilding the whole parent on hover state changes.
// ─────────────────────────────────────────────────────────────────────────────
function FocusMusicTrigger({
  open, station, onToggle,
}: {
  open: boolean;
  station: StationId | null;
  onToggle: () => void;
}) {
  const { attentioned, bind } = useIdleAttention(10_000);
  // While a station is actively playing we keep the pill bright — the
  // user needs the visual cue that audio is on.
  const dim = !attentioned && !station;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Close focus music" : "Open focus music"}
      {...bind}
      style={{
        opacity: dim ? 0.4 : 1,
        filter: dim ? "blur(0.6px)" : "none",
      }}
      className={`
        fixed z-30 right-4 md:right-6
        bottom-[160px] md:bottom-[136px]
        hidden sm:inline-flex items-center gap-1.5
        rounded-full px-3 py-2
        font-mono text-[10px] uppercase tracking-[0.22em]
        transition-[opacity,filter,background-color,border-color] duration-500 ease-out active:scale-[0.97]
        shadow-lg shadow-black/30 backdrop-blur-md
        ${station
          ? "bg-[#A855F7]/[0.18] border border-[#A855F7]/40 text-cream"
          : "bg-white/[0.04] border border-white/[0.1] text-cream/70 hover:text-cream hover:bg-white/[0.08] hover:border-white/[0.2]"
        }
      `}
    >
      <Headphones size={12} weight={station ? "fill" : "bold"} />
      <span>{station ? "Music on" : "Focus music"}</span>
    </button>
  );
}
