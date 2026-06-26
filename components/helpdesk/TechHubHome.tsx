"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarBlank, Moon } from "@phosphor-icons/react";
import { TRACKS, getTrack } from "@/lib/helpdesk/tracks";
import { scenariosForTrack } from "@/lib/helpdesk/scenarios";
import { clearedCount, totalCleared } from "@/lib/helpdesk/progress";
import { dailyShift } from "@/lib/liondesk/daily";
import { trackIconFor } from "@/components/helpdesk/icons";

export default function TechHubHome() {
  // localStorage progress only exists on the client. Read after mount to avoid
  // a hydration mismatch; before mount we render neutral placeholders.
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setMounted(true);
    // Re-read when the tab regains focus (progress may have changed in another tab/route).
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Keyed on `version` so the window-focus refresh (which bumps version) is a
  // real dependency, not just an incidental re-render. Keeps a lint cleanup from
  // silently deleting `version` and breaking the on-focus progress refresh.
  const resolvedTotal = useMemo(() => (mounted ? totalCleared() : 0), [mounted, version]);
  const daily = dailyShift();
  const dailyTrack = getTrack(daily.track);
  const dailyColor = dailyTrack?.color ?? "#FFD700";

  return (
    <div className="space-y-6">
      {/* Shift of the Day — a fresh reason to clock in daily. Rendered after
          mount so server/client date can't cause a hydration mismatch. */}
      {mounted && (
        <Link
          href={`/learn/techhub/${daily.track}/shift?shift=${daily.id}`}
          className="group block rounded-2xl p-4 transition-colors"
          style={{ background: `linear-gradient(110deg, ${dailyColor}1f 0%, rgba(255,215,0,0.06) 60%, rgba(12,16,32,0.95) 100%)`, border: `1px solid ${dailyColor}3a` }}
        >
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${dailyColor}1a`, border: `1px solid ${dailyColor}40` }}>
              <CalendarBlank size={20} weight="fill" color={dailyColor} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold/90">Shift of the day</span>
                <span className="font-mono text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">bonus</span>
              </div>
              <p className="font-syne font-semibold text-sm text-cream mt-0.5 truncate">{daily.name}</p>
              <p className="text-cream/55 text-[11px]">{dailyTrack?.name} · {daily.rank}</p>
            </div>
            <ArrowRight size={16} weight="bold" color={dailyColor} aria-hidden="true" className="flex-shrink-0 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      )}

      {/* Night Shift — the FNAF-style monitoring mode. */}
      <Link
        href="/learn/techhub/nightshift"
        className="group block rounded-2xl p-4 transition-colors"
        style={{ background: "linear-gradient(110deg, rgba(110,139,192,0.14) 0%, rgba(239,68,68,0.07) 65%, rgba(4,6,12,0.96) 100%)", border: "1px solid rgba(110,139,192,0.32)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(110,139,192,0.16)", border: "1px solid rgba(110,139,192,0.45)" }}>
            <Moon size={20} weight="fill" color="#9DB4E0" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bebas text-lg text-cream tracking-wider leading-none">NIGHT SHIFT</p>
              <span className="font-mono text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">New</span>
            </div>
            <p className="text-cream/60 text-xs mt-1.5">Alone in the SOC. Flip the feeds, catch the intruder before it reaches the core, survive til 6 AM.</p>
          </div>
          <ArrowRight size={16} weight="bold" color="#9DB4E0" aria-hidden="true" className="flex-shrink-0 group-hover:translate-x-1 transition-transform" />
        </div>
      </Link>

      {/* Intro */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
        <p className="text-cream/80 text-sm leading-relaxed">
          Pick a career. Tickets land in your queue and you work them in a real terminal: read the
          evidence, investigate, run the fix. Clear tickets to climb the ladder from intern all the way
          to the top. Every ticket is hand-built logic, so there is no guessing your way through.
        </p>
        <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">
          <span>tickets resolved</span>
          <span className="text-gold tabular-nums">{mounted ? resolvedTotal : "—"}</span>
        </div>
      </div>

      {/* Track cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TRACKS.map((track) => {
          const Icon = trackIconFor(track.icon);
          const total = scenariosForTrack(track.id).length;
          const cleared = mounted ? clearedCount(track.id) : 0;
          const rankIdx = Math.min(cleared, track.ranks.length - 1);
          const rankTitle = track.ranks[rankIdx]?.title ?? track.ranks[0]?.title;
          const pct = total > 0 ? Math.min((cleared / total) * 100, 100) : 0;
          return (
            <Link
              key={track.id}
              href={`/learn/techhub/${track.id}`}
              className="group block rounded-2xl p-5 transition-colors"
              style={{
                background: `linear-gradient(135deg, ${track.color}12 0%, rgba(255,255,255,0.015) 100%)`,
                border: `1px solid ${track.color}30`,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ background: `${track.color}1a`, border: `1px solid ${track.color}40` }}
                >
                  <Icon size={22} weight="fill" color={track.color} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bebas text-xl text-cream tracking-wide leading-none">{track.name}</h3>
                    <ArrowRight size={16} weight="bold" aria-hidden="true" className="text-cream/40 group-hover:translate-x-1 transition-transform" style={{ color: track.color }} />
                  </div>
                  <p className="text-cream/55 text-xs mt-1">{track.tagline}</p>
                </div>
              </div>

              <p className="text-cream/70 text-xs leading-relaxed mt-3">{track.blurb}</p>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/55">
                    {mounted ? rankTitle : " "}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-cream/55">
                    {mounted ? `${cleared}/${total}` : `${total} tickets`}
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full transition-[width] duration-700" style={{ width: `${mounted ? pct : 0}%`, background: `linear-gradient(90deg, ${track.color}80, ${track.color})` }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Honesty note: the economy is server-authoritative. */}
      <p className="font-mono text-[10px] text-cream/35 leading-relaxed">
        Fangs and XP shown here are a preview of the reward. They are granted for real once a solve is
        validated on the server, so the in-game economy stays tamper-proof.
      </p>
    </div>
  );
}
