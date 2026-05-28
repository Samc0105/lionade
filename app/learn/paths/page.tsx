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

          {/* Header — left aligned */}
          <div className="mb-8 animate-slide-up">
            <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider leading-none">
              LEARNING PATHS
            </h1>
            <p className="text-cream/40 text-sm sm:text-base mt-2 font-syne">
              Choose a subject and master it stage by stage
            </p>
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
                        <div className="flex items-start justify-between mb-3">
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

                        {/* Title */}
                        <p className="font-bebas text-2xl tracking-wider" style={{ color: meta.color }}>
                          {meta.label}
                        </p>

                        {/* Stage count + stars */}
                        <div className="flex items-center gap-3 mt-1.5">
                          <p className="text-cream/45 text-xs font-syne">
                            {prog.completed}/{total} stages
                          </p>
                          {prog.stars > 0 && (
                            <span className="inline-flex items-center gap-1 text-gold text-xs font-syne font-semibold">
                              <Star size={12} weight="fill" aria-hidden="true" /> {prog.stars}
                            </span>
                          )}
                        </div>

                        {/* Linear progress bar (kept for at-a-glance) */}
                        <div className="mt-4 w-full h-1.5 rounded-full overflow-hidden"
                          style={{ background: "var(--progress-track)", border: "1px solid var(--progress-track-border)" }}>
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${meta.color}80, ${meta.color})` }}
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
              <div className="rounded-2xl border border-gold/20 p-6"
                style={{ background: "var(--card-solid-bg)", boxShadow: "0 0 30px rgba(255,215,0,0.06)" }}>
                <div className="flex items-center gap-2 mb-5">
                  <Path size={18} weight="bold" color="#FFD700" aria-hidden="true" />
                  <h2 className="font-bebas text-lg text-cream tracking-wider leading-none">OVERALL PROGRESS</h2>
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
                        <p className="font-bebas text-4xl text-gold leading-none">{Math.round(summary.pct)}%</p>
                        <p className="text-cream/35 text-[10px] uppercase tracking-widest mt-1">complete</p>
                      </div>
                    </div>

                    {/* Stat rows */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                        style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <span className="text-cream/55 text-xs font-syne">Stages cleared</span>
                        <span className="font-bebas text-lg text-cream tabular-nums">{summary.completedStages}/{summary.totalStages}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                        style={{ background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.12)" }}>
                        <span className="text-cream/55 text-xs font-syne inline-flex items-center gap-1.5">
                          <Star size={12} weight="fill" color="#FFD700" aria-hidden="true" /> Stars earned
                        </span>
                        <span className="font-bebas text-lg text-gold tabular-nums">{summary.totalStars}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                        style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <span className="text-cream/55 text-xs font-syne">Subjects</span>
                        <span className="font-bebas text-lg text-cream tabular-nums">{SUBJECT_ORDER.length}</span>
                      </div>
                    </div>

                    <p className="text-cream/30 text-[11px] leading-relaxed mt-4 font-syne">
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
