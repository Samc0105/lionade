"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import AmbientOrbs from "@/components/AmbientOrbs";
import { getAllSubjectPaths, getUserStageProgress } from "@/lib/db";
import { Ruler, Dna, Bank, Flask, Star, Path, type Icon } from "@phosphor-icons/react";

/* ── Subject config ───────────────────────────────────────── */

const SUBJECT_META: Record<
  string,
  { label: string; icon: Icon; color: string; gradient: string }
> = {
  algebra: {
    label: "Algebra",
    icon: Ruler,
    color: "#3B82F6",
    gradient: "linear-gradient(135deg, #3B82F620 0%, #3B82F608 100%)",
  },
  biology: {
    label: "Biology",
    icon: Dna,
    color: "#22C55E",
    gradient: "linear-gradient(135deg, #22C55E20 0%, #22C55E08 100%)",
  },
  us_history: {
    label: "US History",
    icon: Bank,
    color: "#EAB308",
    gradient: "linear-gradient(135deg, #EAB30820 0%, #EAB30808 100%)",
  },
  chemistry: {
    label: "Chemistry",
    icon: Flask,
    color: "#A855F7",
    gradient: "linear-gradient(135deg, #A855F720 0%, #A855F708 100%)",
  },
};

const SUBJECT_ORDER = ["algebra", "biology", "us_history", "chemistry"];

/* ── Progress ring (SVG) ──────────────────────────────────── */
function ProgressRing({ pct, color, size = 48 }: { pct: number; color: string; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(Math.max(pct, 0), 100) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        className="path-ring"
        style={{ "--ring-circ": circ, "--ring-offset": offset } as React.CSSProperties}
      />
    </svg>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function SubjectSelectorPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<
    { subject: string; total_stages: number }[] | null
  >(null);
  const [progressMap, setProgressMap] = useState<
    Record<string, { completed: number; stars: number }>
  >({});

  useEffect(() => {
    getAllSubjectPaths()
      .then(setSubjects)
      .catch(() => setSubjects([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    getUserStageProgress(user.id)
      .then((progress) => {
        const map: Record<string, { completed: number; stars: number }> = {};
        for (const p of progress) {
          const subj = p.stage?.subject;
          if (!subj) continue;
          if (!map[subj]) map[subj] = { completed: 0, stars: 0 };
          if (p.completed) map[subj].completed++;
          map[subj].stars += p.stars;
        }
        setProgressMap(map);
      })
      .catch(() => {});
  }, [user]);

  // Overall rollup for the right-side summary widget.
  const summary = useMemo(() => {
    if (!subjects) return null;
    let totalStages = 0;
    let completedStages = 0;
    let totalStars = 0;
    for (const key of SUBJECT_ORDER) {
      const subj = subjects.find((s) => s.subject === key);
      const prog = progressMap[key] ?? { completed: 0, stars: 0 };
      totalStages += subj?.total_stages ?? 0;
      completedStages += prog.completed;
      totalStars += prog.stars;
    }
    const pct = totalStages > 0 ? (completedStages / totalStages) * 100 : 0;
    return { totalStages, completedStages, totalStars, pct };
  }, [subjects, progressMap]);

  return (
    <ProtectedRoute>
      <div className="relative min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden" style={{ isolation: "isolate" }}>
        <AmbientOrbs
          orbs={[
            { color: "#3B82F6", pos: "top-[12%] left-[12%]", size: 480, opacity: 0.045 },
            { color: "#22C55E", pos: "top-[40%] right-[10%]", size: 420, opacity: 0.04 },
            { color: "#A855F7", pos: "bottom-[14%] left-[40%]", size: 520, opacity: 0.035 },
          ]}
        />

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackButton />

          {/* Header — eyebrow + lifted title */}
          <div className="mb-8 animate-slide-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70 mb-2">
              Step 1 · pick a subject
            </p>
            <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-[0.08em] leading-none">
              LEARNING PATHS
            </h1>
            <p className="text-cream/45 text-sm sm:text-base mt-3 font-syne max-w-xl leading-relaxed">
              Master subjects one stage at a time. Three stars per stage is total mastery.
            </p>
            {summary !== null && summary.totalStages > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50">
                <span>
                  <span className="text-cream/80 tabular-nums">{SUBJECT_ORDER.length}</span>
                  <span className="ml-1.5 text-cream/40">subjects</span>
                </span>
                <span className="text-cream/20">/</span>
                <span>
                  <span className="text-cream/80 tabular-nums">{summary.completedStages}</span>
                  <span className="text-cream/40">/</span>
                  <span className="text-cream/80 tabular-nums">{summary.totalStages}</span>
                  <span className="ml-1.5 text-cream/40">stages cleared</span>
                </span>
                {summary.totalStars > 0 && (
                  <>
                    <span className="text-cream/20">/</span>
                    <span className="inline-flex items-center gap-1.5 text-gold/85">
                      <Star size={10} weight="fill" aria-hidden="true" />
                      <span className="tabular-nums">{summary.totalStars}</span>
                      <span className="text-gold/55">stars</span>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

            {/* ── LEFT (2/3): subject cards grid ── */}
            <div className="lg:col-span-2">
              {subjects === null ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-44 rounded-2xl animate-pulse" style={{ background: "var(--card-solid-bg)" }} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {SUBJECT_ORDER.map((key, i) => {
                    const meta = SUBJECT_META[key];
                    if (!meta) return null;
                    const subj = subjects.find((s) => s.subject === key);
                    const total = subj?.total_stages ?? 0;
                    const prog = progressMap[key] ?? { completed: 0, stars: 0 };
                    const pct = total > 0 ? (prog.completed / total) * 100 : 0;
                    const IconComp = meta.icon;
                    const isMastered = total > 0 && prog.completed === total;
                    const inProgress = prog.completed > 0 && !isMastered;
                    const statusLabel = isMastered
                      ? "mastered"
                      : inProgress
                      ? "in progress"
                      : "not started";

                    return (
                      <button
                        key={key}
                        onClick={() => router.push(`/learn/paths/${key}`)}
                        className="lift-card group relative p-6 rounded-2xl border text-left cursor-pointer animate-slide-up overflow-hidden"
                        style={{
                          animationDelay: `${0.1 + i * 0.06}s`,
                          background: `${meta.gradient}, var(--card-solid-bg)`,
                          borderColor: `${meta.color}30`,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow = `0 0 36px ${meta.color}28, 0 10px 34px ${meta.color}18`;
                          e.currentTarget.style.borderColor = `${meta.color}60`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.borderColor = `${meta.color}30`;
                        }}
                      >
                        {/* Top row: icon + progress ring */}
                        <div className="flex items-start justify-between mb-4">
                          <span
                            className="w-12 h-12 flex items-center justify-center rounded-xl group-hover:scale-110 transition-transform duration-300"
                            style={{ background: `${meta.color}18`, color: meta.color }}
                          >
                            <IconComp size={28} weight="regular" aria-hidden="true" color="currentColor" />
                          </span>
                          <div className="relative grid place-items-center">
                            <ProgressRing pct={pct} color={meta.color} />
                            <span className="absolute font-bebas text-[11px] tabular-nums" style={{ color: meta.color }}>
                              {Math.round(pct)}%
                            </span>
                          </div>
                        </div>

                        {/* Eyebrow status */}
                        <p
                          className="font-mono text-[9px] uppercase tracking-[0.25em] mb-1"
                          style={{
                            color: isMastered
                              ? "#FFD700CC"
                              : inProgress
                              ? `${meta.color}CC`
                              : "rgba(238,244,255,0.4)",
                          }}
                        >
                          {statusLabel}
                        </p>

                        {/* Title + arrow */}
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bebas text-2xl tracking-[0.08em] leading-none" style={{ color: meta.color }}>
                            {meta.label}
                          </p>
                          <span
                            className="font-mono text-base translate-x-0 group-hover:translate-x-1 transition-transform duration-300"
                            style={{ color: `${meta.color}AA` }}
                            aria-hidden="true"
                          >
                            &rarr;
                          </span>
                        </div>

                        {/* Stage count + stars */}
                        <div className="flex items-center gap-3 mt-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                          <span className="text-cream/55">
                            <span className="text-cream/85 tabular-nums">{prog.completed}</span>
                            <span className="text-cream/35">/</span>
                            <span className="text-cream/85 tabular-nums">{total}</span>
                            <span className="ml-1 text-cream/40">stages</span>
                          </span>
                          {prog.stars > 0 && (
                            <span className="inline-flex items-center gap-1 text-gold/85">
                              <Star size={10} weight="fill" aria-hidden="true" />
                              <span className="tabular-nums">{prog.stars}</span>
                            </span>
                          )}
                        </div>

                        {/* Linear progress bar */}
                        <div
                          className="mt-4 w-full h-1.5 rounded-full overflow-hidden"
                          style={{ background: "var(--progress-track)", border: "1px solid var(--progress-track-border)" }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${pct}%`,
                              background: isMastered
                                ? `linear-gradient(90deg, ${meta.color}, #FFD700)`
                                : `linear-gradient(90deg, ${meta.color}80, ${meta.color})`,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── RIGHT (1/3): overall path progress summary ── */}
            <div className="animate-slide-up" style={{ animationDelay: "0.16s" }}>
              <div
                className="rounded-2xl border border-gold/25 p-6"
                style={{ background: "var(--card-solid-bg)", boxShadow: "0 0 30px rgba(255,215,0,0.08)" }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Path size={16} weight="bold" color="#FFD700" aria-hidden="true" />
                    <h2 className="font-bebas text-base text-cream tracking-[0.18em] leading-none">OVERALL</h2>
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-gold/55">
                    your path
                  </span>
                </div>

                {summary === null ? (
                  <div className="space-y-3">
                    <div className="h-32 rounded-xl bg-white/5 animate-pulse" />
                    <div className="h-12 rounded-xl bg-white/5 animate-pulse" />
                  </div>
                ) : (
                  <>
                    {/* Big ring */}
                    <div className="relative grid place-items-center mb-5">
                      <ProgressRing pct={summary.pct} color="#FFD700" size={128} />
                      <div className="absolute text-center">
                        <p className="font-bebas text-4xl text-gold leading-none tabular-nums">
                          {Math.round(summary.pct)}<span className="text-2xl text-gold/60">%</span>
                        </p>
                        <p className="text-cream/40 text-[9px] uppercase tracking-[0.3em] mt-1.5 font-mono">
                          complete
                        </p>
                      </div>
                    </div>

                    {/* Stat rows */}
                    <div className="space-y-2">
                      <div
                        className="flex items-center justify-between rounded-xl px-3 py-2.5"
                        style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
                          stages cleared
                        </span>
                        <span className="font-bebas text-lg text-cream tabular-nums tracking-wider">
                          {summary.completedStages}<span className="text-cream/35">/</span>{summary.totalStages}
                        </span>
                      </div>
                      <div
                        className="flex items-center justify-between rounded-xl px-3 py-2.5"
                        style={{ background: "rgba(255,215,0,0.05)", border: "1px solid rgba(255,215,0,0.14)" }}
                      >
                        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold/65 inline-flex items-center gap-1.5">
                          <Star size={11} weight="fill" color="#FFD700" aria-hidden="true" />
                          stars earned
                        </span>
                        <span className="font-bebas text-lg text-gold tabular-nums tracking-wider">
                          {summary.totalStars}
                        </span>
                      </div>
                      <div
                        className="flex items-center justify-between rounded-xl px-3 py-2.5"
                        style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
                          subjects
                        </span>
                        <span className="font-bebas text-lg text-cream tabular-nums tracking-wider">
                          {SUBJECT_ORDER.length}
                        </span>
                      </div>
                    </div>

                    <p className="text-cream/35 text-[11px] leading-relaxed mt-4 font-syne">
                      Clear stages to fill the ring. Three stars per stage means total mastery.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
