"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockSimple, CheckCircle, CaretRight, Desktop, ArrowRight } from "@phosphor-icons/react";
import type { Track, SimScenario } from "@/lib/helpdesk/types";
import { getTrack } from "@/lib/helpdesk/tracks";
import { scenariosForTrack } from "@/lib/helpdesk/scenarios";
import { shiftsForTrack } from "@/lib/liondesk/shifts";
import { clearedCountForTrack } from "@/lib/liondesk/campaignProgress";
import { getCleared, markCleared } from "@/lib/helpdesk/progress";
import { trackIconFor } from "@/components/helpdesk/icons";
import HelpDeskSim from "@/components/helpdesk/HelpDeskSim";

const DIFF_COLOR: Record<string, string> = {
  Entry: "#2BBE6B",
  Intermediate: "#4A90D9",
  Advanced: "#F59E0B",
  Expert: "#EF4444",
};

export default function TrackView({ track }: { track: Track }) {
  const def = getTrack(track);
  const scenarios = useMemo(() => scenariosForTrack(track), [track]);

  const [mounted, setMounted] = useState(false);
  const [cleared, setCleared] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setCleared(getCleared(track));
  }, [track]);

  if (!def) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-center">
        <p className="text-cream/70 text-sm">Unknown track.</p>
        <Link href="/learn/techhub" className="text-electric text-sm mt-2 inline-block">← Back to TechHub</Link>
      </div>
    );
  }

  const Icon = trackIconFor(def.icon);
  const clearedCount = cleared.length;
  const total = scenarios.length;
  const rankIdx = Math.min(clearedCount, def.ranks.length - 1);
  const currentRank = def.ranks[rankIdx]?.title ?? def.ranks[0]?.title;
  // Campaign (shift) progress, used on the "Start your shift" CTA.
  const shiftCount = shiftsForTrack(track).length;
  const campaignCleared = mounted ? clearedCountForTrack(track) : 0;
  const campaignRank = def.ranks[Math.min(campaignCleared, def.ranks.length - 1)]?.title ?? def.ranks[0]?.title;
  // A ticket unlocks once you've cleared enough tickets to reach its rung.
  const isUnlocked = (s: SimScenario) => s.rankLevel <= clearedCount;
  const ranksWithTickets = new Set(scenarios.map((s) => s.rankLevel));

  function handleResolved(s: SimScenario) {
    const next = markCleared(track, s.id);
    setCleared(next);
  }

  const selected = selectedId ? scenarios.find((s) => s.id === selectedId) ?? null : null;

  // After clearing, the next thing to play = lowest-rank unlocked + uncleared ticket.
  const nextScenario = useMemo(() => {
    return (
      scenarios.find((s) => s.id !== selectedId && s.rankLevel <= cleared.length && !cleared.includes(s.id)) ?? null
    );
  }, [scenarios, selectedId, cleared]);

  /* ── PLAY VIEW ── */
  if (selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedId(null)}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/55 hover:text-electric transition-colors"
        >
          <ArrowLeft size={14} weight="bold" aria-hidden="true" /> back to {def.name} queue
        </button>
        <HelpDeskSim
          scenario={selected}
          alreadyCleared={cleared.includes(selected.id)}
          onResolved={handleResolved}
          onNext={nextScenario ? () => setSelectedId(nextScenario.id) : () => setSelectedId(null)}
          nextLabel={nextScenario ? `Next ticket: ${nextScenario.rank} →` : "Back to the queue →"}
        />
      </div>
    );
  }

  /* ── QUEUE VIEW ── */
  return (
    <div className="space-y-6">
      {/* Track header */}
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${def.color}1a`, border: `1px solid ${def.color}40` }}>
          <Icon size={26} weight="fill" color={def.color} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bebas text-2xl text-cream tracking-wide leading-none">{def.name}</h2>
          <p className="text-cream/55 text-xs mt-1">{def.tagline}</p>
        </div>
      </div>

      {/* LionDesk shift — the immersive workstation (any track that has shifts) */}
      {shiftsForTrack(track).length > 0 && (
        <Link
          href={`/learn/techhub/${track}/shift`}
          className="group block rounded-2xl p-5 transition-colors"
          style={{ background: "linear-gradient(110deg, rgba(74,144,217,0.14) 0%, rgba(255,215,0,0.06) 60%, rgba(12,16,32,0.95) 100%)", border: "1px solid rgba(74,144,217,0.32)" }}
        >
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(74,144,217,0.16)", border: "1px solid rgba(74,144,217,0.45)" }}>
              <Desktop size={24} weight="fill" color="#4A90D9" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-bebas text-xl text-cream tracking-wider leading-none">START YOUR SHIFT</p>
                <span className="font-mono text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded bg-electric/15 text-electric border border-electric/30">New</span>
              </div>
              <p className="text-cream/65 text-xs mt-1.5">A full desktop: emails, tickets, and texts land in real time. Triage the chaos and clear your shift.</p>
              {mounted && shiftCount > 0 && (
                <p className="font-mono text-[10px] text-cream/45 mt-1">Rank: {campaignRank} · {campaignCleared}/{shiftCount} shifts cleared</p>
              )}
            </div>
            <ArrowRight size={18} weight="bold" color="#4A90D9" aria-hidden="true" className="flex-shrink-0 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      )}

      {/* Rank ladder — the full career timeline */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">career ladder</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: def.color }}>
            {mounted ? currentRank : " "}
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          {def.ranks.map((r) => {
            const reached = mounted && r.level <= rankIdx;
            const isCurrent = mounted && r.level === rankIdx;
            const hasTickets = ranksWithTickets.has(r.level);
            return (
              <div
                key={r.level}
                className="flex-shrink-0 rounded-lg px-3 py-2 min-w-[112px]"
                style={{
                  background: isCurrent ? `${def.color}1f` : reached ? `${def.color}12` : "rgba(255,255,255,0.02)",
                  border: isCurrent ? `1px solid ${def.color}` : reached ? `1px solid ${def.color}33` : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] tabular-nums text-cream/40">{String(r.level + 1).padStart(2, "0")}</span>
                  {hasTickets && <span className="w-1.5 h-1.5 rounded-full" style={{ background: def.color }} aria-hidden="true" />}
                </div>
                <p className="text-[11px] leading-tight mt-1" style={{ color: reached ? "#F5EBDA" : "rgba(245,235,218,0.45)" }}>
                  {r.title}
                </p>
              </div>
            );
          })}
        </div>
        <p className="font-mono text-[9px] text-cream/35 mt-1">
          dotted rungs have live tickets. the rest are the road ahead.
        </p>
      </div>

      {/* Ticket queue */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">ticket queue</span>
          <span className="font-mono text-[10px] tabular-nums text-cream/55">{mounted ? `${clearedCount}/${total} cleared` : `${total} tickets`}</span>
        </div>
        <ul className="space-y-2">
          {scenarios.map((s) => {
            const unlocked = mounted ? isUnlocked(s) : s.rankLevel === 0;
            const done = mounted && cleared.includes(s.id);
            const diffColor = DIFF_COLOR[s.difficulty] ?? "#4A90D9";
            const needed = s.rankLevel - clearedCount;
            return (
              <li key={s.id}>
                <button
                  disabled={!unlocked}
                  onClick={() => unlocked && setSelectedId(s.id)}
                  className={`w-full text-left rounded-xl border p-4 transition-colors ${
                    unlocked ? "hover:bg-white/[0.03] hover:border-white/20 cursor-pointer" : "opacity-50 cursor-not-allowed"
                  }`}
                  style={{ borderColor: done ? "#2BBE6B40" : "rgba(255,255,255,0.08)", background: done ? "rgba(43,190,107,0.05)" : "rgba(255,255,255,0.02)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {done ? (
                        <CheckCircle size={20} weight="fill" color="#2BBE6B" aria-hidden="true" />
                      ) : unlocked ? (
                        <CaretRight size={18} weight="bold" color={def.color} aria-hidden="true" />
                      ) : (
                        <LockSimple size={18} weight="fill" color="#6B7280" aria-hidden="true" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45">{s.rank}</span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full" style={{ color: diffColor, background: `${diffColor}1f`, border: `1px solid ${diffColor}40` }}>
                          {s.difficulty}
                        </span>
                      </div>
                      <p className="font-syne font-semibold text-sm text-cream mt-1 truncate">{s.ticket.subject}</p>
                      {!unlocked && (
                        <p className="font-mono text-[10px] text-cream/45 mt-0.5">
                          clear {needed} more ticket{needed === 1 ? "" : "s"} to unlock
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="font-bebas text-base tabular-nums text-gold leading-none">+{s.reward}</p>
                      <p className="font-mono text-[9px] text-cream/45">Fangs</p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
