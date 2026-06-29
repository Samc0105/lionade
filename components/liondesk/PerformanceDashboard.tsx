"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChartBar, Trophy, Lightning, Target, CalendarBlank, ArrowRight, Medal } from "@phosphor-icons/react";
import { getStats, getCareerLevel, type TechhubStats, type CareerLevel } from "@/lib/liondesk/stats";
import { getMaxNightSurvived, getEndlessBest } from "@/lib/liondesk/nightshift";
import { getPlayStreak, type PlayStreak } from "@/lib/liondesk/playstreak";
import {
  getConceptMastery,
  getWeakestConcepts,
  hasMasteryData,
  type ConceptMasteryRow,
  type MasteryLevel,
} from "@/lib/liondesk/conceptMastery";
import { getAllRecords, gradeFor, PASS_SCORE, type ShiftRecord } from "@/lib/liondesk/campaignProgress";
import { getAllTrackMastery, trackMasterySkeleton, type TrackMastery } from "@/lib/liondesk/trackMastery";
import { shiftsForTrack, getShift } from "@/lib/liondesk/shifts";
import { TRACKS } from "@/lib/helpdesk/tracks";
import { getRecentDays, type CalendarCell } from "@/lib/liondesk/dailyLog";
import type { Track } from "@/lib/helpdesk/types";

// Personal performance dashboard for TechHub. Read only: every number here comes
// from the same local stores the rest of TechHub already keeps (lifetime stats,
// campaign records, concept mastery, the daily clock-in log). Nothing here grants
// Fangs, talks to an API, or touches the economy (which stays server
// authoritative). Mount guarded so a first paint never shows a misleading zero.

const LEVEL_COLOR: Record<MasteryLevel, string> = {
  none: "#6B7280",
  weak: "#EF4444",
  ok: "#4A90D9",
  strong: "#2BBE6B",
};

// How many cleared modes a trend column represents, mapped to a color so a strong
// day reads gold, a light day reads electric blue.
const TREND_COLOR = ["rgba(255,255,255,0.08)", "#4A90D9", "#A855F7", "#FFD700"];

interface TrackPerf {
  id: Track;
  name: string;
  color: string;
  total: number;
  cleared: number;
  played: number;
  bestScore: number;
  avgScore: number;
}

interface TopShift {
  id: string;
  name: string;
  track: string;
  bestScore: number;
  grade: string;
}

function computeTrackPerf(records: Record<string, ShiftRecord>): TrackPerf[] {
  return TRACKS.map((t) => {
    const shifts = shiftsForTrack(t.id);
    let cleared = 0;
    let played = 0;
    let bestScore = 0;
    let sum = 0;
    for (const s of shifts) {
      const r = records[s.id];
      if (!r) continue;
      played++;
      sum += r.bestScore;
      bestScore = Math.max(bestScore, r.bestScore);
      if (r.bestScore >= PASS_SCORE) cleared++;
    }
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      total: shifts.length,
      cleared,
      played,
      bestScore,
      avgScore: played ? Math.round(sum / played) : 0,
    };
  });
}

function computeTopShifts(records: Record<string, ShiftRecord>): TopShift[] {
  const out: TopShift[] = [];
  for (const [id, r] of Object.entries(records)) {
    const sh = getShift(id);
    if (!sh) continue;
    out.push({ id, name: sh.name, track: sh.track, bestScore: r.bestScore, grade: gradeFor(r.bestScore) });
  }
  return out.sort((a, b) => b.bestScore - a.bestScore).slice(0, 5);
}

// Concepts you fumble most, weakest first, limited to ones with real data.
function computeWeakConcepts(): ConceptMasteryRow[] {
  return getConceptMastery()
    .filter((r) => r.pct !== null)
    .sort((a, b) => (a.pct! - b.pct!) || (b.total - a.total))
    .slice(0, 5);
}

export default function PerformanceDashboard() {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<TechhubStats | null>(null);
  const [career, setCareer] = useState<CareerLevel | null>(null);
  const [streak, setStreak] = useState<PlayStreak>({ current: 0, best: 0, lastDay: "" });
  const [night, setNight] = useState({ max: 0, endless: 0 });
  const [trackPerf, setTrackPerf] = useState<TrackPerf[]>([]);
  const [mastery, setMastery] = useState<TrackMastery[]>([]);
  const [topShifts, setTopShifts] = useState<TopShift[]>([]);
  const [weakRows, setWeakRows] = useState<ConceptMasteryRow[]>([]);
  const [weakIds, setWeakIds] = useState<string[]>([]);
  const [hasConcepts, setHasConcepts] = useState(false);
  const [trend, setTrend] = useState<CalendarCell[]>([]);
  const [totalPlays, setTotalPlays] = useState(0);

  useEffect(() => {
    const records = getAllRecords();
    setMounted(true);
    setStats(getStats());
    setCareer(getCareerLevel());
    setStreak(getPlayStreak());
    setNight({ max: getMaxNightSurvived(), endless: getEndlessBest() });
    setTrackPerf(computeTrackPerf(records));
    setMastery(getAllTrackMastery());
    setTopShifts(computeTopShifts(records));
    setWeakRows(computeWeakConcepts());
    setWeakIds(getWeakestConcepts(3));
    setHasConcepts(hasMasteryData());
    setTrend(getRecentDays(14));
    setTotalPlays(Object.values(records).reduce((n, r) => n + r.plays, 0));
  }, []);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const dash = mounted ? null : "…";

  // Top summary tiles, the headline of the page.
  const summary = [
    { label: "shifts cleared", value: stats?.shiftsCleared ?? 0 },
    { label: "total plays", value: totalPlays },
    { label: "day streak", value: streak.current },
    { label: "career level", value: career?.level ?? 1 },
  ];

  // Lifetime records, the personal bests.
  const records = [
    { label: "best score", value: stats ? `${stats.bestShiftScore} (${gradeFor(stats.bestShiftScore)})` : 0 },
    { label: "perfect (100%)", value: stats?.perfectShifts ?? 0 },
    { label: "longest watch", value: night.endless ? fmt(night.endless) : "none yet" },
    { label: "nights survived", value: night.max },
    { label: "best run streak", value: stats?.bestStreak ?? 0 },
    { label: "career XP", value: stats?.careerXp ?? 0 },
  ];

  const activeDays = trend.filter((c) => c.cleared > 0).length;

  return (
    <div className="space-y-6">
      {/* headline summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {summary.map((t) => (
          <div key={t.label} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-center">
            <p className="font-bebas text-3xl tabular-nums text-cream leading-none">{dash ?? t.value}</p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1.5">{t.label}</p>
          </div>
        ))}
      </div>

      {/* career level */}
      {mounted && career && (
        <div className="rounded-2xl border border-electric/25 bg-electric/[0.05] p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bebas text-2xl text-cream flex-shrink-0" style={{ background: "rgba(74,144,217,0.18)", border: "1px solid rgba(74,144,217,0.4)" }}>{career.level}</div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-electric/90">level {career.level}</p>
              <p className="font-bebas text-2xl text-cream tracking-wide leading-none">{career.title}</p>
              <div className="h-1.5 rounded-full overflow-hidden bg-white/10 mt-2">
                <div className="h-full motion-safe:transition-[width] motion-safe:duration-700 ease-out" style={{ width: `${career.pct}%`, background: "linear-gradient(90deg,#4A90D9,#FFD700)" }} />
              </div>
              <p className="font-mono text-[9px] text-cream/45 mt-1">{career.intoLevel} / {career.forNext} XP to level {career.level + 1}</p>
            </div>
          </div>
        </div>
      )}

      {/* per track performance */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <ChartBar size={14} weight="fill" color="#4A90D9" aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">per track performance</p>
        </div>
        <ul className="space-y-2.5">
          {(mounted ? trackPerf : TRACK_SKELETON).map((t, i) => {
            const skeleton = !mounted;
            const width = !skeleton && t.total ? Math.round((t.cleared / t.total) * 100) : 0;
            return (
              <li key={skeleton ? i : t.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: skeleton ? "rgba(255,255,255,0.12)" : t.color }} />
                  <span className="text-cream/90 text-[13px] font-semibold">{skeleton ? "…" : t.name}</span>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-cream/70">
                    {skeleton ? "…" : `${t.cleared} of ${t.total} cleared`}
                  </span>
                </div>
                <div className="mt-2 h-2 w-full rounded-full overflow-hidden bg-white/[0.06]" role="img" aria-label={skeleton ? "loading" : `${t.name}: ${t.cleared} of ${t.total} shifts cleared`}>
                  <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 ease-out" style={{ width: `${width}%`, background: skeleton ? "rgba(255,255,255,0.12)" : t.color }} />
                </div>
                {!skeleton && (
                  <p className="mt-1.5 font-mono text-[10px] text-cream/40">
                    {t.played === 0
                      ? "Not started yet. Clear a shift to begin tracking this track."
                      : `Best score ${t.bestScore}, average ${t.avgScore} over ${t.played} shift${t.played === 1 ? "" : "s"} played.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* per track mastery rank (Idea 37). Blends cleared shifts, average grade,
          and concept mastery into one rank per track. A fully cleared track also
          earns a cosmetic top of ladder title (preview only, never any Fangs).
          Mount guarded with a skeleton so it never flashes a row of zeros. */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Medal size={14} weight="fill" color="#C9A2F2" aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">track mastery</p>
        </div>
        <ul className="space-y-2.5">
          {(mounted ? mastery : MASTERY_SKELETON).map((m, i) => {
            const skeleton = !mounted;
            const width = skeleton ? 0 : m.pct;
            const tierColor = skeleton ? "rgba(255,255,255,0.12)" : m.tier.color;
            return (
              <li key={skeleton ? i : m.id} className="rounded-xl border bg-white/[0.02] p-3" style={{ borderColor: !skeleton && m.complete ? `${m.color}59` : "rgba(255,255,255,0.08)" }}>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: skeleton ? "rgba(255,255,255,0.12)" : m.color }} />
                  <span className="text-cream/90 text-[13px] font-semibold">{skeleton ? "…" : m.name}</span>
                  <span className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: tierColor, background: skeleton ? "rgba(255,255,255,0.06)" : `${m.tier.color}1f` }}>{skeleton ? "…" : m.tier.name}</span>
                  <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color: tierColor }}>{skeleton ? "…" : `${m.pct}%`}</span>
                </div>
                <div className="mt-2 h-2 w-full rounded-full overflow-hidden bg-white/[0.06]" role="img" aria-label={skeleton ? "loading" : `${m.name}: ${m.tier.name} rank, ${m.pct}% mastery`}>
                  <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 ease-out" style={{ width: `${width}%`, background: tierColor }} />
                </div>
                {!skeleton && (
                  <p className="mt-1.5 font-mono text-[10px] text-cream/40">
                    {m.complete
                      ? `Track complete. Average grade ${m.avgGrade}. Cosmetic earned: ${m.cosmetic.title} title.`
                      : m.played === 0
                        ? "Not started yet. Clear shifts to climb this track's mastery rank."
                        : `${m.cleared} of ${m.total} cleared, average grade ${m.avgGrade}${m.conceptPct !== null ? `, concepts ${m.conceptPct}%` : ""}.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* lifetime records */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Trophy size={14} weight="fill" color="#FFD700" aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">best scores and records</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {records.map((r) => (
            <div key={r.label} className="rounded-lg border border-white/[0.07] bg-white/[0.015] p-2.5 text-center">
              <p className="font-bebas text-xl tabular-nums text-cream leading-none">{dash ?? r.value}</p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1">{r.label}</p>
            </div>
          ))}
        </div>

        {/* top scoring shifts */}
        {mounted && topShifts.length > 0 && (
          <ul className="space-y-1.5 mt-3">
            {topShifts.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
                <span className="font-bebas text-lg w-7 text-center tabular-nums" style={{ color: s.bestScore >= 90 ? "#FFD700" : s.bestScore >= 65 ? "#4A90D9" : "#C9A2F2" }}>{s.grade}</span>
                <span className="text-cream text-sm font-semibold truncate">{s.name}</span>
                <span className="ml-auto font-mono text-[11px] tabular-nums text-cream/55">{s.bestScore}</span>
              </li>
            ))}
          </ul>
        )}
        {mounted && topShifts.length === 0 && (
          <p className="font-mono text-[10px] text-cream/40 mt-3">Clear a campaign shift to start logging your best scores here.</p>
        )}
      </div>

      {/* streak summary */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Lightning size={14} weight="fill" color="#FB923C" aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">streak summary</p>
        </div>
        <div className="rounded-2xl border border-orange-400/25 bg-orange-400/[0.05] p-4">
          <div className="flex items-center gap-3">
            <span className="font-bebas text-4xl tabular-nums leading-none" style={{ color: "#FB923C" }}>{dash ?? streak.current}</span>
            <div className="flex-1 min-w-0">
              <p className="font-bebas text-xl text-cream tracking-wide leading-none">day streak</p>
              <p className="font-mono text-[10px] text-cream/45 mt-1">
                {!mounted
                  ? "Loading your streak..."
                  : streak.current > 0
                    ? `Clocking in keeps it alive.${streak.best > streak.current ? ` Your best run is ${streak.best} days.` : " This is your best run so far."}`
                    : streak.best > 0
                      ? `No active streak. Clear a shift today to start again. Your best run was ${streak.best} days.`
                      : "Clear a shift on any day to start a streak."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* weakest concepts */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target size={14} weight="fill" color="#C9A2F2" aria-hidden="true" />
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">weakest concepts</p>
          </div>
          <Link href="/learn/techhub/review" className="group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-[#C9A2F2] hover:text-cream transition-colors">
            drill these <ArrowRight size={12} weight="bold" aria-hidden="true" className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
        {mounted && !hasConcepts ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <p className="font-mono text-[11px] text-cream/50 leading-relaxed">Finish a few shifts to map your concept mastery. Once you do, the concepts you miss most show up here so you know where to drill.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {(mounted ? weakRows : CONCEPT_SKELETON).map((row, i) => {
              const skeleton = !mounted;
              const color = LEVEL_COLOR[skeleton ? "none" : row.level];
              const width = skeleton ? 0 : row.pct ?? 0;
              const isFocus = mounted && weakIds.includes(row.concept);
              return (
                <li key={skeleton ? i : row.concept} className="rounded-xl border bg-white/[0.02] p-3" style={{ borderColor: isFocus ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-cream/90 text-[13px] font-semibold">{skeleton ? "…" : row.label}</span>
                    {isFocus && (
                      <span className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.16)", color: "#F8B4B4" }}>focus</span>
                    )}
                    <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color }}>{skeleton ? "…" : `${row.pct}%`}</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full overflow-hidden bg-white/[0.06]" role="img" aria-label={skeleton ? "loading" : `${row.label}: ${row.pct}% mastery`}>
                    <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 ease-out" style={{ width: `${width}%`, background: color }} />
                  </div>
                  {!skeleton && (
                    <p className="mt-1.5 font-mono text-[10px] text-cream/40">{row.correct} of {row.total} handled{row.total < 3 ? " (still learning)" : ""}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* recent activity trend */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <CalendarBlank size={14} weight="fill" color="#FFD700" aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">last 14 days</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-end justify-between gap-1.5 h-20" role="img" aria-label={mounted ? `${activeDays} of the last 14 days active` : "loading activity trend"}>
            {(mounted ? trend : TREND_SKELETON).map((c, i) => {
              const skeleton = !mounted;
              const cleared = skeleton ? 0 : c.cleared;
              const heightPct = skeleton ? 8 : cleared === 0 ? 6 : 25 + Math.round((cleared / 3) * 75);
              return (
                <div key={skeleton ? i : c.day} className="flex-1 flex flex-col justify-end h-full">
                  <div
                    className="w-full rounded-sm motion-safe:transition-[height] motion-safe:duration-700 ease-out"
                    style={{
                      height: `${heightPct}%`,
                      background: skeleton ? "rgba(255,255,255,0.06)" : TREND_COLOR[Math.min(cleared, 3)],
                      outline: !skeleton && c.isToday ? "1px solid rgba(255,215,0,0.6)" : "none",
                      outlineOffset: "1px",
                    }}
                  />
                </div>
              );
            })}
          </div>
          <p className="font-mono text-[10px] text-cream/45 mt-3">
            {mounted ? `${activeDays} active day${activeDays === 1 ? "" : "s"} in the last 14. Each bar counts how many daily modes you cleared that day.` : "Loading your activity..."}
          </p>
        </div>
      </div>

      <p className="font-mono text-[10px] text-cream/40 leading-relaxed">
        Every number here is a personal record stored on this device. It tracks nothing toward your balance (the economy stays server authoritative, so nothing here grants Fangs).
      </p>
    </div>
  );
}

// Placeholders so each section has shape before mount, never a row of zeros.
const TRACK_SKELETON: TrackPerf[] = TRACKS.map((t) => ({ id: t.id, name: t.name, color: t.color, total: 0, cleared: 0, played: 0, bestScore: 0, avgScore: 0 }));
const MASTERY_SKELETON: TrackMastery[] = trackMasterySkeleton();
const CONCEPT_SKELETON: ConceptMasteryRow[] = Array.from({ length: 4 }).map(() => ({ concept: "", label: "", correct: 0, total: 0, pct: null, confident: false, level: "none" }));
const TREND_SKELETON: CalendarCell[] = Array.from({ length: 14 }).map(() => ({ day: "", cleared: 0, modes: [], isToday: false }));
