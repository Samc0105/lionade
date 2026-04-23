"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getQuizHistory } from "@/lib/db";
import { SUBJECT_ICONS, SUBJECT_COLORS, DefaultSubjectIcon } from "@/lib/mockData";
import { getLevelProgress } from "@/lib/levels";
import type { Subject } from "@/types";
import { apiGet } from "@/lib/api-client";
import { NotePencil, Fire, BookOpen, PawPrint, ArrowRight, Target, Brain } from "@phosphor-icons/react";
import CountUp from "@/components/CountUp";

/* ── Relative Time Helper ─────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── Types ─────────────────────────────────────────────────── */

interface QuizHistoryEntry {
  id: string;
  subject: string;
  total_questions: number;
  correct_answers: number;
  coins_earned: number;
  completed_at: string;
}

interface Mission {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  target: number;
  coinReward: number;
  xpReward: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

/* ── Page ───────────────────────────────────────────────────── */

export default function LearnPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { stats } = useUserStats(user?.id);
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [missions, setMissions] = useState<Mission[]>([]);

  useEffect(() => {
    if (!user) return;
    // Pull more history so the 7-day heatmap + subject-mastery computations
    // have something to work with. 60 covers the vast majority of use cases
    // since DAILY_QUESTION_LIMIT caps per-day contributions anyway.
    getQuizHistory(user.id, 60)
      .then((history) => {
        setQuizHistory(history);
        const today = new Date().toISOString().split("T")[0];
        const todayQuestions = history
          .filter((h: any) => h.completed_at?.startsWith(today))
          .reduce((sum: number, h: any) => sum + h.total_questions, 0);
        setTodayCount(todayQuestions);
      })
      .catch(() => {});
    apiGet<{ missions: Mission[] }>("/api/missions/progress")
      .then(res => { if (res.ok && res.data) setMissions(res.data.missions); })
      .catch(() => {});
  }, [user]);

  const recentActivity = quizHistory.slice(0, 5);
  const dailyGoal = 10;
  const goalRemaining = Math.max(0, dailyGoal - todayCount);
  const dailyProgressPct = Math.min((todayCount / dailyGoal) * 100, 100);
  const li = getLevelProgress(stats?.xp ?? user?.xp ?? 0);

  // ── 7-day study heatmap ──────────────────────────────────────
  // For each of the last 7 days, count total questions answered. Today is
  // the last cell on the right.
  const heatmap = useMemo(() => {
    const days: { date: string; label: string; dow: string; count: number; isToday: boolean }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split("T")[0];
      const count = quizHistory
        .filter(h => h.completed_at?.startsWith(iso))
        .reduce((sum, h) => sum + h.total_questions, 0);
      days.push({
        date: iso,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        dow: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1).toUpperCase(),
        count,
        isToday: i === 0,
      });
    }
    return days;
  }, [quizHistory]);

  const weekTotal = heatmap.reduce((s, d) => s + d.count, 0);

  // ── Subject mastery ──────────────────────────────────────────
  // Group quiz history by subject. Accuracy = correct / total.
  // Sorted weakest-first so the "what to study next" answer surfaces.
  const mastery = useMemo(() => {
    const byS: Record<string, { answered: number; correct: number; lastAt: string }> = {};
    for (const h of quizHistory) {
      const s = h.subject;
      if (!byS[s]) byS[s] = { answered: 0, correct: 0, lastAt: h.completed_at };
      byS[s].answered += h.total_questions;
      byS[s].correct += h.correct_answers;
      if (h.completed_at > byS[s].lastAt) byS[s].lastAt = h.completed_at;
    }
    return Object.entries(byS)
      .map(([subject, v]) => ({
        subject,
        answered: v.answered,
        correct: v.correct,
        accuracy: v.answered > 0 ? Math.round((v.correct / v.answered) * 100) : 0,
        lastAt: v.lastAt,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);
  }, [quizHistory]);

  const weakestSubject = mastery.length > 0 && mastery[0].accuracy < 70 ? mastery[0].subject : null;

  // Primary CTA copy adapts to whether you've hit the daily goal
  const primaryCtaTitle = goalRemaining > 0
    ? (todayCount === 0 ? "Start today's quiz" : "Finish today's goal")
    : "You're done for today — push further?";
  const primaryCtaSub = goalRemaining > 0
    ? (todayCount === 0
        ? `${dailyGoal} questions keeps your streak alive`
        : `${goalRemaining} more question${goalRemaining === 1 ? "" : "s"} to hit your goal`)
    : weakestSubject
    ? `Sharpen up — your weakest subject is ${weakestSubject}`
    : "Daily goal hit. Try a harder difficulty or a new subject.";

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.45s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
      `}</style>

      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* ═══ 1. Simple page heading ═══ */}
          <header className="mb-7 animate-slide-up flex items-baseline justify-between">
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.08em] leading-none">
              Learn
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/30">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }).toLowerCase()}
            </p>
          </header>

          {/* ═══ 2. STAT ROW — 4 real metrics ═══ */}
          <section className="mb-7 grid grid-cols-2 sm:grid-cols-4 gap-2 animate-slide-up" style={{ animationDelay: "0.04s" }}>
            {([
              { label: "streak",        value: stats?.streak ?? user?.streak ?? 0,  suffix: "day",  Icon: Fire,      color: "#F97316" },
              { label: "level",         value: li.level,                             suffix: null,   Icon: null,      color: li.tier.color, extra: li.tier.name.toLowerCase() },
              { label: "today",         value: todayCount,                           suffix: `/ ${dailyGoal}`, Icon: Target, color: "#4A90D9" },
              { label: "this week",     value: weekTotal,                            suffix: "q",    Icon: BookOpen,  color: "#22C55E" },
            ] as const).map(chip => {
              const ChipIcon = chip.Icon;
              const displayValue = typeof chip.value === "number" ? chip.value : 0;
              return (
                <div key={chip.label}
                  className="rounded-[6px] px-4 py-3 relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${chip.color}10 0%, rgba(255,255,255,0.015) 100%)`,
                    border: `1px solid ${chip.color}22`,
                  }}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/45">
                      {chip.label}
                    </p>
                    {ChipIcon && <ChipIcon size={12} weight="fill" color={chip.color} aria-hidden="true" />}
                  </div>
                  <p className="font-bebas text-[26px] tabular-nums leading-none" style={{ color: chip.color }}>
                    <CountUp value={displayValue} duration={600} />
                    {chip.suffix && <span className="text-cream/30 text-sm ml-1.5">{chip.suffix}</span>}
                  </p>
                  {"extra" in chip && chip.extra && (
                    <p className="text-cream/35 text-[10px] mt-0.5 font-mono lowercase truncate">{chip.extra}</p>
                  )}
                </div>
              );
            })}
          </section>

          {/* ═══ 3. PRIMARY START CTA — context-aware ═══ */}
          <section className="mb-10 animate-slide-up" style={{ animationDelay: "0.08s" }}>
            <Link
              href={weakestSubject ? `/quiz?subject=${encodeURIComponent(weakestSubject)}` : "/quiz"}
              className="group block rounded-[10px] p-6 sm:p-7 transition-all duration-200 hover:-translate-y-0.5"
              style={{
                background: "linear-gradient(110deg, rgba(74,144,217,0.10) 0%, rgba(255,215,0,0.06) 60%, rgba(12,16,32,0.95) 100%)",
                border: "1px solid rgba(255,215,0,0.22)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70 mb-2">
                    next up
                  </p>
                  <p className="font-bebas text-2xl sm:text-3xl text-cream tracking-wider leading-tight">
                    {primaryCtaTitle}
                  </p>
                  <p className="text-cream/50 text-xs sm:text-sm mt-1.5">
                    {primaryCtaSub}
                  </p>
                </div>
                <div className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-transform duration-200 group-hover:translate-x-1"
                  style={{ background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.35)" }}>
                  <ArrowRight size={20} weight="bold" color="#FFD700" aria-hidden="true" />
                </div>
              </div>

              {/* Daily goal progress bar — embedded in the CTA */}
              <div className="mt-5 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className={`h-full ${dailyProgressPct > 0 && dailyProgressPct < 100 ? "progress-shimmer" : ""}`}
                  style={{
                    width: `${dailyProgressPct}%`,
                    background: dailyProgressPct >= 100
                      ? "linear-gradient(90deg, #22C55E 0%, #FFD700 100%)"
                      : "linear-gradient(90deg, #4A90D9 0%, #FFD700 100%)",
                    transition: "width 900ms var(--ease-out-emil)",
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/30">daily goal</p>
                <p className="font-mono text-[10px] tabular-nums text-cream/50">
                  {Math.min(todayCount, dailyGoal)} / {dailyGoal}
                </p>
              </div>
            </Link>

            {/* Secondary actions — 3 clean rows, not cards */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Link href="/learn/paths" className="group flex items-center gap-3 px-4 py-3 rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-electric/30 transition-colors">
                <BookOpen size={18} weight="regular" color="#3B82F6" aria-hidden="true" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-sm text-cream leading-tight">Subjects</p>
                  <p className="text-cream/30 text-[10px] font-mono">7 learning paths</p>
                </div>
                <ArrowRight size={14} weight="regular" color="rgba(238,244,255,0.3)" aria-hidden="true" className="group-hover:text-electric transition-colors" />
              </Link>

              <Link href="/learn/ninny" className="group flex items-center gap-3 px-4 py-3 rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-[#A855F7]/30 transition-colors">
                <PawPrint size={18} weight="fill" color="#A855F7" aria-hidden="true" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-sm text-cream leading-tight">Study with Ninny</p>
                  <p className="text-cream/30 text-[10px] font-mono">ai tutor</p>
                </div>
                <ArrowRight size={14} weight="regular" color="rgba(238,244,255,0.3)" aria-hidden="true" className="group-hover:text-[#A855F7] transition-colors" />
              </Link>

              <Link href="/learn/mastery" className="group flex items-center gap-3 px-4 py-3 rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-gold/30 transition-colors text-left">
                <Brain size={18} weight="fill" color="#FFD700" aria-hidden="true" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-sm text-cream leading-tight">Mastery Mode</p>
                  <p className="text-cream/30 text-[10px] font-mono">any exam · any topic</p>
                </div>
                <ArrowRight size={14} weight="regular" color="rgba(238,244,255,0.3)" aria-hidden="true" className="group-hover:text-gold transition-colors" />
              </Link>
            </div>
          </section>

          {/* ═══ 4. Two-column content area ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

            {/* ── LEFT (3/5): Subject mastery + missions ── */}
            <div className="lg:col-span-3 space-y-10">

              {/* SUBJECT MASTERY */}
              <section className="animate-slide-up" style={{ animationDelay: "0.12s" }}>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">MASTERY</h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/30">
                    {mastery.length} {mastery.length === 1 ? "subject" : "subjects"} · weakest first
                  </p>
                </div>

                {mastery.length === 0 ? (
                  <div className="py-8 border-y border-white/[0.04] text-center">
                    <p className="text-cream/40 text-sm mb-3">No data yet. One quiz and this fills in.</p>
                    <Link href="/quiz" className="inline-block font-syne font-bold text-xs px-5 py-2 rounded-full border border-electric/40 text-electric hover:bg-electric/10 transition-colors">
                      Start a quiz
                    </Link>
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {mastery.map(m => {
                      const subj = m.subject as Subject;
                      const color = SUBJECT_COLORS[subj] ?? "#4A90D9";
                      const MasteryIcon = SUBJECT_ICONS[subj] ?? DefaultSubjectIcon;
                      const isWeak = m.accuracy < 60;
                      return (
                        <li key={m.subject}>
                          <Link
                            href={`/quiz?subject=${encodeURIComponent(m.subject)}`}
                            className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 px-3 rounded-[4px] border border-transparent hover:border-white/[0.08] hover:bg-white/[0.02] transition-all"
                          >
                            <MasteryIcon size={18} weight="regular" color={color} aria-hidden="true" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <p className="font-syne font-semibold text-sm text-cream truncate">{m.subject}</p>
                                {isWeak && (
                                  <span className="font-mono text-[9px] uppercase tracking-wider text-red-400/80">weak</span>
                                )}
                                <span className="font-mono text-[9px] text-cream/30 ml-auto tabular-nums">
                                  {m.correct}/{m.answered}
                                </span>
                              </div>
                              {/* Accuracy bar */}
                              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                                <div
                                  className="h-full"
                                  style={{
                                    width: `${m.accuracy}%`,
                                    background: `linear-gradient(90deg, ${color}70, ${color})`,
                                    transition: "width 900ms var(--ease-out-emil)",
                                  }}
                                />
                              </div>
                            </div>
                            <p className="font-bebas text-xl tabular-nums" style={{ color }}>
                              {m.accuracy}<span className="text-cream/30 text-xs">%</span>
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* TODAY'S MISSIONS */}
              {missions.length > 0 && (
                <section className="animate-slide-up" style={{ animationDelay: "0.16s" }}>
                  <div className="flex items-baseline justify-between mb-4">
                    <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">TODAY&rsquo;S MISSIONS</h2>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/30">resets 00:00</p>
                  </div>

                  <ul className="space-y-2">
                    {missions.map(m => {
                      const pct = Math.min((m.progress / m.target) * 100, 100);
                      return (
                        <li
                          key={m.id}
                          className="relative rounded-[6px] px-4 py-3 flex items-center gap-3"
                          style={{
                            background: m.completed
                              ? `linear-gradient(90deg, ${m.color}08 0%, rgba(255,215,0,0.04) 100%)`
                              : "rgba(255,255,255,0.02)",
                            border: m.completed
                              ? `1px solid ${m.color}40`
                              : "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          {/* Accent bar on the left edge — 2px, not a stripe; contained within border-radius */}
                          <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${m.color}14`, border: `1px solid ${m.color}35` }}>
                            <span className="text-sm" aria-hidden="true">{m.icon}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <p className="font-syne font-semibold text-sm text-cream truncate">{m.title}</p>
                              {m.claimed && <span className="font-mono text-[9px] uppercase tracking-wider text-green-400/80">claimed</span>}
                              {m.completed && !m.claimed && <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: m.color }}>ready</span>}
                            </div>
                            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                              <div
                                className={`h-full ${pct > 0 && pct < 100 && !m.claimed ? "progress-shimmer" : ""}`}
                                style={{
                                  width: `${pct}%`,
                                  background: `linear-gradient(90deg, ${m.color}70, ${m.color})`,
                                  transition: "width 800ms var(--ease-out-emil)",
                                }}
                              />
                            </div>
                          </div>

                          <div className="flex-shrink-0 text-right">
                            <p className="font-bebas text-sm tabular-nums" style={{ color: m.color }}>
                              {m.progress}<span className="text-cream/30 text-xs">/{m.target}</span>
                            </p>
                            <p className="font-mono text-[9px] text-gold/70">+{m.coinReward}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

            </div>

            {/* ── RIGHT (2/5): Heatmap + recent log ── */}
            <div className="lg:col-span-2 space-y-10">

              {/* 7-DAY HEATMAP */}
              <section className="animate-slide-up" style={{ animationDelay: "0.12s" }}>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">7-DAY ACTIVITY</h2>
                  <p className="font-mono text-[10px] tabular-nums text-cream/30">{weekTotal} questions</p>
                </div>

                <div className="grid grid-cols-7 gap-1.5">
                  {heatmap.map(d => {
                    // Intensity buckets: 0 → bg/5, 1-4 → 15%, 5-9 → 40%, 10-19 → 70%, 20+ → 100%
                    const intensity =
                      d.count === 0 ? 0 :
                      d.count < 5   ? 0.18 :
                      d.count < 10  ? 0.42 :
                      d.count < 20  ? 0.72 :
                                      1;
                    return (
                      <div
                        key={d.date}
                        className="aspect-square rounded-[3px] flex flex-col items-center justify-center transition-all hover:scale-110"
                        style={{
                          background: intensity === 0
                            ? "rgba(255, 255, 255, 0.04)"
                            : `rgba(34, 197, 94, ${intensity})`,
                          border: d.isToday ? "1px solid rgba(255, 215, 0, 0.7)" : "1px solid rgba(255,255,255,0.04)",
                          boxShadow: d.isToday ? "0 0 8px rgba(255, 215, 0, 0.35)" : "none",
                        }}
                        title={`${d.label} · ${d.count} question${d.count === 1 ? "" : "s"}`}
                      >
                        <span className="font-mono text-[9px] leading-none" style={{ color: intensity > 0.5 ? "rgba(255,255,255,0.8)" : "rgba(238,244,255,0.4)" }}>
                          {d.dow}
                        </span>
                        {d.count > 0 && (
                          <span className="font-bebas text-xs tabular-nums leading-none mt-0.5" style={{ color: intensity > 0.5 ? "#fff" : "rgba(238,244,255,0.6)" }}>
                            {d.count}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Heatmap legend */}
                <div className="flex items-center justify-end gap-1.5 mt-3">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-cream/30">less</span>
                  {[0.04, 0.18, 0.42, 0.72, 1].map((o, i) => (
                    <span key={i} className="w-2.5 h-2.5 rounded-[2px]" style={{
                      background: o < 0.1 ? "rgba(255, 255, 255, 0.04)" : `rgba(34, 197, 94, ${o})`,
                    }} />
                  ))}
                  <span className="font-mono text-[9px] uppercase tracking-wider text-cream/30">more</span>
                </div>
              </section>

              {/* RECENT LOG — clean list */}
              <section className="animate-slide-up" style={{ animationDelay: "0.18s" }}>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">RECENT</h2>
                  <Link href="/quiz" className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40 hover:text-electric transition-colors">
                    new →
                  </Link>
                </div>

                {recentActivity.length === 0 ? (
                  <div className="py-8 text-center border-y border-white/[0.04]">
                    <p className="text-cream/30 text-xs mb-3">No quizzes yet</p>
                    <Link href="/quiz" className="inline-block font-syne font-bold text-xs px-4 py-2 rounded-full border border-electric/40 text-electric hover:bg-electric/10 transition-colors">
                      Start
                    </Link>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/[0.04]">
                    {recentActivity.map(entry => {
                      const subj = entry.subject as Subject;
                      const RecentIcon = SUBJECT_ICONS[subj] ?? DefaultSubjectIcon;
                      const color = SUBJECT_COLORS[subj] ?? "#4A90D9";
                      const pct = entry.total_questions > 0 ? Math.round((entry.correct_answers / entry.total_questions) * 100) : 0;
                      return (
                        <li key={entry.id}>
                          <Link href="/quiz" className="flex items-center gap-3 py-3 hover:bg-white/[0.02] transition-colors -mx-2 px-2 rounded-[4px]">
                            <RecentIcon size={16} weight="regular" color={color} aria-hidden="true" />
                            <div className="flex-1 min-w-0">
                              <p className="text-cream text-xs font-semibold truncate">{entry.subject}</p>
                              <p className="text-cream/30 text-[10px] font-mono">{timeAgo(entry.completed_at)}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bebas text-sm tabular-nums" style={{ color }}>
                                {pct}<span className="text-cream/30 text-[10px]">%</span>
                              </p>
                              <p className="font-mono text-[9px] text-gold/70">+{entry.coins_earned}</p>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

            </div>
          </div>

        </div>
      </div>

    </ProtectedRoute>
  );
}
