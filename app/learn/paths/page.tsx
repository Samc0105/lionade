"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { getAllSubjectPaths, getUserStageProgress } from "@/lib/db";

/* ── Subject config ───────────────────────────────────────── */

const SUBJECT_META: Record<
  string,
  { label: string; icon: string; color: string; gradient: string }
> = {
  algebra: {
    label: "Algebra",
    icon: "\u{1F4D0}",
    color: "#3B82F6",
    gradient: "linear-gradient(135deg, #3B82F620 0%, #3B82F608 100%)",
  },
  biology: {
    label: "Biology",
    icon: "\u{1F9EC}",
    color: "#22C55E",
    gradient: "linear-gradient(135deg, #22C55E20 0%, #22C55E08 100%)",
  },
  us_history: {
    label: "US History",
    icon: "\u{1F3DB}",
    color: "#EAB308",
    gradient: "linear-gradient(135deg, #EAB30820 0%, #EAB30808 100%)",
  },
  chemistry: {
    label: "Chemistry",
    icon: "\u{2697}",
    color: "#A855F7",
    gradient: "linear-gradient(135deg, #A855F720 0%, #A855F708 100%)",
  },
};

const SUBJECT_ORDER = ["algebra", "biology", "us_history", "chemistry"];

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

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackButton />

          {/* Header */}
          <div className="text-center mb-10 animate-slide-up">
            <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider">
              LEARNING PATHS
            </h1>
            <p className="text-cream/40 text-sm sm:text-base mt-2 font-syne">
              Choose a subject and master it stage by stage
            </p>
          </div>

          {/* Subject cards */}
          {subjects === null ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-40 rounded-2xl animate-pulse"
                  style={{ background: "var(--card-solid-bg)" }}
                />
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

                return (
                  <button
                    key={key}
                    onClick={() => router.push(`/learn/paths/${key}`)}
                    className="group relative p-6 rounded-2xl border text-left transition-all duration-300
                      hover:-translate-y-1 cursor-pointer animate-slide-up"
                    style={{
                      animationDelay: `${0.1 + i * 0.05}s`,
                      background: "var(--card-solid-bg)",
                      borderColor: `${meta.color}30`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = `0 0 30px ${meta.color}25, 0 8px 32px ${meta.color}15`;
                      e.currentTarget.style.borderColor = `${meta.color}60`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.borderColor = `${meta.color}30`;
                    }}
                  >
                    {/* Icon */}
                    <span className="text-4xl block mb-3 group-hover:scale-110 transition-transform duration-300">
                      {meta.icon}
                    </span>

                    {/* Title */}
                    <p
                      className="font-bebas text-2xl tracking-wider"
                      style={{ color: meta.color }}
                    >
                      {meta.label}
                    </p>

                    {/* Progress text */}
                    <p className="text-cream/40 text-xs font-syne mt-1">
                      {prog.completed}/{total} stages complete
                      {prog.stars > 0 && (
                        <span className="ml-2 text-gold">
                          {"★".repeat(Math.min(prog.stars, 5))}
                          {prog.stars > 5 && ` ${prog.stars}`}
                        </span>
                      )}
                    </p>

                    {/* Progress bar */}
                    <div className="mt-3 w-full h-2 rounded-full overflow-hidden"
                      style={{ background: "var(--progress-track)", border: "1px solid var(--progress-track-border)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, ${meta.color}80, ${meta.color})`,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
