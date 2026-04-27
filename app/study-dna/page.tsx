"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  CaretLeft, ShareNetwork, Fire, Sparkle, TrendUp, TrendDown, Trophy,
  Target, BookOpen, Clock, Coin, Brain, Lightning,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { swrFetcher } from "@/lib/api-client";
import ShareCard, { type ShareCardData } from "@/components/ShareCard";

/**
 * Study DNA — visualizes the user's study identity.
 *
 *   - Identity card: computed title + blurb + headline stats (streak, level, fangs)
 *   - Totals strip: questions answered, accuracy, classes, exam targets, notes,
 *     drills, focus sessions
 *   - Strengths / Weaknesses: top + bottom subtopics with mini bars
 *   - 30-day activity heatmap: GitHub-contribution-graph style
 *   - Share button: opens ShareCard with the identity stats
 */

interface SubjectStat {
  name: string;
  masteryPct: number;
  attempts: number;
  correct: number;
  key: string;
  source: string;
}

interface DnaResponse {
  identity: {
    title: string;
    blurb: string;
    streak: number;
    bestStreak: number;
    level: number;
    xp: number;
    lifetimeFangs: number;
  };
  totals: {
    questionsAnswered: number;
    correct: number;
    accuracy: number;
    classesCount: number;
    examTargetsCount: number;
    notesCount: number;
    drillCompletions: number;
    drillPerfectRuns: number;
    focusSessionsCompleted: number;
  };
  strengths: SubjectStat[];
  weaknesses: SubjectStat[];
  heatmap: Array<{ date: string; value: number }>;
}

export default function StudyDnaPage() {
  const { data, isLoading } = useSWR<DnaResponse>(
    "/api/study-dna", swrFetcher,
    { revalidateOnFocus: true, keepPreviousData: true },
  );
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <Navbar />

        <main className="relative z-10 max-w-[1080px] mx-auto px-4 sm:px-6 pt-6 pb-24">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream transition-colors mb-4"
          >
            <CaretLeft size={12} weight="bold" /> Dashboard
          </Link>

          <div className="flex items-end justify-between gap-3 mb-6 flex-wrap">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold mb-2">
                Study DNA
              </p>
              <h1 className="font-bebas text-4xl sm:text-5xl tracking-[0.06em] text-cream leading-none">
                your study identity
              </h1>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/45 mt-2">
                Strengths, weaknesses, and how the grind shows
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              disabled={!data}
              className="inline-flex items-center gap-2 rounded-full bg-gold text-navy hover:bg-gold/90
                font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2.5
                disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 active:scale-[0.98]"
            >
              <ShareNetwork size={12} weight="fill" /> Share
            </button>
          </div>

          {isLoading && !data ? (
            <DnaSkeleton />
          ) : !data ? (
            <p className="text-cream/50 text-[14px]">Couldn&apos;t load your DNA right now.</p>
          ) : (
            <>
              <IdentityCard dna={data} />
              <TotalsStrip dna={data} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <StrengthsList stats={data.strengths} />
                <WeaknessesList stats={data.weaknesses} />
              </div>
              <Heatmap heatmap={data.heatmap} />
            </>
          )}
        </main>

        {data && (
          <ShareCard
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            shareTitle={`${data.identity.title.toLowerCase().replace(/\s+/g, "-")}-dna`}
            card={buildShareCardFromDna(data)}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the canvas share card from the DNA response.
// ─────────────────────────────────────────────────────────────────────────────
function buildShareCardFromDna(dna: DnaResponse): ShareCardData {
  return {
    headline: "STUDY DNA",
    subline: dna.identity.title,
    bigNumber: {
      value: `${Math.round(dna.totals.accuracy * 100)}%`,
      label: "Accuracy",
    },
    stats: [
      { label: "Streak", value: `${dna.identity.streak}d` },
      { label: "Level", value: String(dna.identity.level) },
      { label: "Questions", value: String(dna.totals.questionsAnswered) },
    ],
    accent: "#FFD700",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity card — the star piece. Title + blurb + headline stats.
// ─────────────────────────────────────────────────────────────────────────────
function IdentityCard({ dna }: { dna: DnaResponse }) {
  const { identity, totals } = dna;
  return (
    <section className="mb-6 rounded-[14px] overflow-hidden border border-gold/30 bg-gradient-to-br from-gold/[0.06] via-transparent to-transparent">
      <div className="absolute h-1 left-0 right-0 top-0" />
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-2">
          <Sparkle size={13} className="text-gold" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Your title
          </span>
        </div>
        <h2 className="font-bebas text-[42px] sm:text-[56px] tracking-[0.04em] text-cream leading-[0.95] mb-2">
          {identity.title}
        </h2>
        <p className="text-[14px] text-cream/75 leading-relaxed mb-5 max-w-[60ch]">
          {identity.blurb}
        </p>

        {/* Headline stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <HeadlineStat icon={<Fire size={14} weight="fill" />} value={`${identity.streak}d`} label="Streak" accent="#F97316" />
          <HeadlineStat icon={<TrendUp size={14} weight="bold" />} value={`${Math.round(totals.accuracy * 100)}%`} label="Accuracy" accent="#22C55E" />
          <HeadlineStat icon={<Trophy size={14} weight="fill" />} value={String(identity.level)} label="Level" accent="#A855F7" />
          <HeadlineStat icon={<Coin size={14} weight="fill" />} value={formatCompact(identity.lifetimeFangs)} label="Lifetime F" accent="#FFD700" />
        </div>
      </div>
    </section>
  );
}

function HeadlineStat({ icon, value, label, accent }: { icon: React.ReactNode; value: string; label: string; accent: string; }) {
  return (
    <div className="rounded-[10px] bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 flex items-center gap-2.5">
      <div
        className="grid place-items-center w-8 h-8 rounded-full shrink-0"
        style={{ background: `${accent}1f`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-bebas text-[22px] tabular-nums tracking-wider text-cream leading-none">
          {value}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/45 mt-0.5 truncate">
          {label}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Totals strip — secondary numbers in a single horizontal row.
// ─────────────────────────────────────────────────────────────────────────────
function TotalsStrip({ dna }: { dna: DnaResponse }) {
  const items = [
    { icon: <Brain size={11} weight="bold" />, label: "Questions", value: dna.totals.questionsAnswered },
    { icon: <Target size={11} weight="bold" />, label: "Exam targets", value: dna.totals.examTargetsCount },
    { icon: <BookOpen size={11} weight="bold" />, label: "Classes", value: dna.totals.classesCount },
    { icon: <BookOpen size={11} weight="bold" />, label: "Notes", value: dna.totals.notesCount },
    { icon: <Lightning size={11} weight="bold" />, label: "Drills", value: dna.totals.drillCompletions },
    { icon: <Trophy size={11} weight="bold" />, label: "Perfect drills", value: dna.totals.drillPerfectRuns },
    { icon: <Clock size={11} weight="bold" />, label: "Focus sessions", value: dna.totals.focusSessionsCompleted },
  ];
  return (
    <section className="mb-8 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-[10px] bg-white/[0.02] border border-white/[0.05] px-3 py-2.5"
        >
          <div className="flex items-center gap-1 text-cream/50 mb-1">
            {it.icon}
            <span className="font-mono text-[8.5px] uppercase tracking-[0.2em]">{it.label}</span>
          </div>
          <div className="font-bebas text-[22px] tabular-nums tracking-wider text-cream leading-none">
            {it.value}
          </div>
        </div>
      ))}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Strengths / Weaknesses lists
// ─────────────────────────────────────────────────────────────────────────────
function StrengthsList({ stats }: { stats: SubjectStat[] }) {
  return (
    <section className="rounded-[12px] border border-[#22C55E]/25 bg-[#22C55E]/[0.04] p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <TrendUp size={13} weight="bold" className="text-[#22C55E]" />
        <h3 className="font-bebas text-sm tracking-[0.2em] text-cream/85">STRENGTHS</h3>
      </div>
      {stats.length === 0 ? (
        <p className="text-cream/40 text-[12.5px]">
          Answer some questions in Mastery Mode to see your strengths.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stats.map((s) => (
            <StatRow key={s.key} stat={s} barColor="#22C55E" />
          ))}
        </ul>
      )}
    </section>
  );
}

function WeaknessesList({ stats }: { stats: SubjectStat[] }) {
  return (
    <section className="rounded-[12px] border border-[#EF4444]/25 bg-[#EF4444]/[0.04] p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <TrendDown size={13} weight="bold" className="text-[#EF4444]" />
        <h3 className="font-bebas text-sm tracking-[0.2em] text-cream/85">WEAK SPOTS</h3>
      </div>
      {stats.length === 0 ? (
        <p className="text-cream/40 text-[12.5px]">
          No clear weak spots yet — keep going for at least 3 attempts per subtopic.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stats.map((s) => (
            <StatRow key={s.key} stat={s} barColor="#EF4444" />
          ))}
        </ul>
      )}
    </section>
  );
}

function StatRow({ stat, barColor }: { stat: SubjectStat; barColor: string }) {
  return (
    <li className="rounded-[8px] bg-white/[0.025] border border-white/[0.04] px-3 py-2">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[12.5px] text-cream/90 truncate">{stat.name}</span>
        <span className="font-mono text-[10px] tabular-nums text-cream/55 shrink-0">
          {Math.round(stat.masteryPct)}%
        </span>
      </div>
      <div className="h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(2, stat.masteryPct)}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/35 mt-1">
        {stat.correct} / {stat.attempts} answered
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 30-day activity heatmap (GitHub-style)
// ─────────────────────────────────────────────────────────────────────────────
function Heatmap({ heatmap }: { heatmap: Array<{ date: string; value: number }> }) {
  // Find the cap to scale colors. Use 90th percentile so a single
  // monster day doesn't wash out everything else.
  const sorted = [...heatmap].map(d => d.value).sort((a, b) => a - b);
  const cap = sorted[Math.floor(sorted.length * 0.9)] || 1;

  // Bucket 0..4 for color intensity.
  const intensity = (v: number) => {
    if (v === 0) return 0;
    const r = Math.min(1, v / cap);
    return r >= 0.75 ? 4 : r >= 0.5 ? 3 : r >= 0.25 ? 2 : 1;
  };

  // Group into weeks (cols) × days (rows). UTC weekday: 0 = Sun.
  // We'll go simple: just show 30 cells in a 5-row × 6-col grid sorted
  // chronologically, to keep it readable on mobile.
  const cells = heatmap;

  return (
    <section className="rounded-[12px] border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-bebas text-sm tracking-[0.2em] text-cream/85">
          LAST 30 DAYS
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40">
          {cells.filter(c => c.value > 0).length} active days
        </span>
      </div>
      <div className="grid grid-cols-15 gap-[5px]" style={{ gridTemplateColumns: "repeat(15, 1fr)" }}>
        {cells.map((c) => (
          <div
            key={c.date}
            title={`${c.date}: ${c.value} action${c.value === 1 ? "" : "s"}`}
            className="aspect-square rounded-[3px]"
            style={{
              background: cellColor(intensity(c.value)),
            }}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-3">
        <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-cream/35">less</span>
        {[0, 1, 2, 3, 4].map(b => (
          <span key={b} className="w-2.5 h-2.5 rounded-[2px]" style={{ background: cellColor(b) }} />
        ))}
        <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-cream/35">more</span>
      </div>
    </section>
  );
}

function cellColor(intensity: number): string {
  if (intensity === 0) return "rgba(255,255,255,0.04)";
  if (intensity === 1) return "rgba(74,144,217,0.25)";
  if (intensity === 2) return "rgba(74,144,217,0.55)";
  if (intensity === 3) return "rgba(255,215,0,0.75)";
  return "#FFD700";
}

// ─────────────────────────────────────────────────────────────────────────────
function DnaSkeleton() {
  return (
    <>
      <div className="h-44 rounded-[14px] bg-white/[0.03] border border-white/[0.06] animate-pulse mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-8">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-16 rounded-[10px] bg-white/[0.03] animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="h-44 rounded-[12px] bg-white/[0.03] animate-pulse" />
        <div className="h-44 rounded-[12px] bg-white/[0.03] animate-pulse" />
      </div>
      <div className="h-32 rounded-[12px] bg-white/[0.03] animate-pulse" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function formatCompact(n: number): string {
  if (n >= 100_000) return `${Math.floor(n / 1000)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
