"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import { useQuizHistory } from "@/lib/hooks";
import useSWR from "swr";
import { SUBJECT_ICONS, SUBJECT_COLORS, DefaultSubjectIcon } from "@/lib/mockData";
import { getLevelProgress } from "@/lib/levels";
import type { Subject } from "@/types";
import { apiGet } from "@/lib/api-client";
import { Fire, BookOpen, PawPrint, ArrowRight, Target, Brain, Books, Briefcase, Crown } from "@phosphor-icons/react";
import { usePlan } from "@/lib/use-plan";
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
  const { user } = useAuth();
  const { stats, isLoading: statsLoading } = useUserStats(user?.id);
  const { plan } = usePlan();
  const isPro = plan === "pro" || plan === "platinum";
  const reduceMotion = useReducedMotion();

  // P0 trust-gap fix 2026-06-05: the Subjects/Learning Paths CTA used to
  // fire a "Coming Soon" toast even though /learn/paths and
  // /learn/paths/[subject] are both fully shipped (you can deep-link
  // to them from other parts of the app). Gate removed — the row is
  // now a real <Link href="/learn/paths">.
  // Perf 2026-05-17: raw useEffect+db/api fetches → SWR so the global
  // persistent <SWRConfig> cache renders Learn instantly on re-nav instead of
  // a cold refetch + empty flash. Quiz history uses the SHARED useQuizHistory
  // hook (key `quiz-history/${id}/60`, deduped with Dashboard). Missions stay
  // page-local behind a stable key. `quizHistory`/`todayCount`/`missions`
  // derived to preserve the prior computations (heatmap, mastery, today goal)
  // byte-for-byte. 60 still covers the 7-day heatmap + subject-mastery since
  // DAILY_QUESTION_LIMIT caps per-day contributions anyway.
  const { data: historyData } = useQuizHistory(user?.id, 60);
  // No-flash-of-zero gate: while the quiz-history SWR is resolving its FIRST
  // value (`undefined`, before keepPreviousData has anything to keep) every
  // derived metric below — heatmap, streak week-total, mastery, today's count —
  // would compute from an empty array and paint real zeros. We render
  // skeletons until this resolves so the heatmap/streak never flash 0.
  const historyLoading = historyData === undefined;
  const quizHistory: QuizHistoryEntry[] =
    (historyData as QuizHistoryEntry[] | undefined) ?? [];
  const todayCount = (() => {
    const today = new Date().toISOString().split("T")[0];
    return quizHistory
      .filter(h => h.completed_at?.startsWith(today))
      .reduce((sum, h) => sum + h.total_questions, 0);
  })();
  const { data: missionsData } = useSWR(
    user?.id ? `learn-missions/${user.id}` : null,
    async () => {
      const res = await apiGet<{ missions: Mission[] }>("/api/missions/progress");
      return res.ok && res.data ? res.data.missions : [];
    },
    { keepPreviousData: true }
  );
  const missions: Mission[] = missionsData ?? [];

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

  // Hours since the user's last activity (most recent quiz). Used below to
  // freshen the copy when someone hit the daily goal hours ago and is back
  // on the page — sitting on "you're done" for 11+ hours after a 2 AM grind
  // session reads as "stop studying" when they're clearly here to study.
  // We DON'T reset the daily-goal flag itself (would corrupt the streak
  // math); we only swap the headline and subtitle so the page feels alive.
  const lastActivityAt = quizHistory[0]?.completed_at;
  const hoursSinceLastActivity = lastActivityAt
    ? (Date.now() - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60)
    : Infinity;
  const goalMetReturning = goalRemaining === 0 && hoursSinceLastActivity >= 5;

  // Primary CTA copy adapts to whether you've hit the daily goal AND how
  // long it's been since your last activity.
  const primaryCtaTitle = goalRemaining > 0
    ? (todayCount === 0 ? "Start today's quiz" : "Finish today's goal")
    : goalMetReturning
    ? "Welcome back — ready for round 2?"
    : "You're done for today — push further?";
  const primaryCtaSub = goalRemaining > 0
    ? (todayCount === 0
        ? `${dailyGoal} questions keeps your streak alive`
        : `${goalRemaining} more question${goalRemaining === 1 ? "" : "s"} to hit your goal`)
    : goalMetReturning
    ? (weakestSubject
        ? `You crushed today's goal earlier — keep the momentum on ${weakestSubject}`
        : "You crushed today's goal earlier — keep the momentum going")
    : weakestSubject
    ? `Sharpen up — your weakest subject is ${weakestSubject}`
    : "Daily goal hit. Try a harder difficulty or a new subject.";

  // Stagger helper: returns the entrance delay only when motion is allowed.
  // Under prefers-reduced-motion the local @media rule already disables the
  // animation; nulling the delay keeps the inline style from re-triggering it.
  const delay = (d: string) => (reduceMotion ? undefined : { animationDelay: d });

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.45s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
        /* Reduced-motion: drop the entrance translate/animation entirely so
           content appears instantly at full opacity. Belt-and-suspenders with
           the useReducedMotion() gate that strips animationDelay below. */
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
        }
        .skeleton-shimmer {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 37%, rgba(255,255,255,0.04) 63%);
          background-size: 400% 100%;
          animation: skeleton-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes skeleton-shimmer {
          0% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .skeleton-shimmer { animation: none; }
        }
      `}</style>

      <FeatureGate feature="learn">
      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* ═══ 1. Simple page heading ═══ */}
          <header className="mb-7 animate-slide-up flex items-baseline justify-between">
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.08em] leading-none">
              Learn
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }).toLowerCase()}
            </p>
          </header>

          {/* ═══ 2. STAT ROW — 4 real metrics ═══ */}
          <section className="mb-7 grid grid-cols-2 sm:grid-cols-4 gap-2 animate-slide-up" style={delay("0.04s")}>
            {([
              { label: "streak",        value: stats?.streak ?? user?.streak ?? 0,  suffix: "day",  Icon: Fire,      color: "#F97316", loading: statsLoading && stats == null && user?.streak == null },
              { label: "level",         value: li.level,                             suffix: null,   Icon: null,      color: li.tier.color, extra: li.tier.name.toLowerCase(), loading: statsLoading && stats == null && user?.xp == null },
              { label: "today",         value: todayCount,                           suffix: `/ ${dailyGoal}`, Icon: Target, color: "#4A90D9", loading: historyLoading },
              { label: "this week",     value: weekTotal,                            suffix: "q",    Icon: BookOpen,  color: "#22C55E", loading: historyLoading },
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
                    <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/60">
                      {chip.label}
                    </p>
                    {ChipIcon && <ChipIcon size={12} weight="fill" color={chip.color} aria-hidden="true" />}
                  </div>
                  {/* No-flash-of-zero: a loading chip shows a shimmer bar, never a
                      hard 0, until its data source resolves. */}
                  {chip.loading ? (
                    <div className="skeleton-shimmer rounded h-[26px] w-3/4" aria-hidden="true" />
                  ) : (
                    <p className="font-bebas text-[26px] tabular-nums leading-none" style={{ color: chip.color }}>
                      <CountUp id={`learn-chip-${chip.label}`} value={displayValue} duration={600} />
                      {chip.suffix && <span className="text-cream/55 text-sm ml-1.5">{chip.suffix}</span>}
                    </p>
                  )}
                  {"extra" in chip && chip.extra && !chip.loading && (
                    <p className="text-cream/60 text-[10px] mt-0.5 font-mono lowercase truncate">{chip.extra}</p>
                  )}
                </div>
              );
            })}
          </section>

          {/* ═══ 3. PRIMARY START CTA — context-aware ═══ */}
          <section className="mb-10 animate-slide-up" style={delay("0.08s")}>
            <Link
              href={weakestSubject ? `/quiz?subject=${encodeURIComponent(weakestSubject)}` : "/quiz"}
              className="fluid-card-hover press-feedback group block rounded-[10px] p-6 sm:p-7"
              style={{
                background: "linear-gradient(110deg, rgba(74,144,217,0.10) 0%, rgba(255,215,0,0.06) 60%, rgba(12,16,32,0.95) 100%)",
                border: "1px solid rgba(255,215,0,0.22)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/80 mb-2">
                    next up
                  </p>
                  <p className="font-bebas text-2xl sm:text-3xl text-cream tracking-wider leading-tight">
                    {primaryCtaTitle}
                  </p>
                  <p className="text-cream/70 text-xs sm:text-sm mt-1.5">
                    {primaryCtaSub}
                  </p>
                </div>
                <div className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-transform duration-200 group-hover:translate-x-1"
                  style={{ background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.35)" }}>
                  <ArrowRight size={20} weight="bold" color="#FFD700" aria-hidden="true" />
                </div>
              </div>

              {/* Daily goal progress bar — embedded in the CTA */}
              <FeatureGate feature="learn.daily_goal" compact>
                <div
                  className="mt-5 h-1 rounded-full overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                  role="progressbar"
                  aria-label="Daily goal progress"
                  aria-valuemin={0}
                  aria-valuemax={dailyGoal}
                  aria-valuenow={historyLoading ? undefined : Math.min(todayCount, dailyGoal)}
                  aria-valuetext={historyLoading ? "Loading" : `${Math.min(todayCount, dailyGoal)} of ${dailyGoal} questions today`}
                >
                  {/* No-flash: keep the fill at 0 width while loading rather than
                      letting it compute a real 0% from an empty history array. */}
                  {!historyLoading && (
                    <div
                      className={`h-full ${dailyProgressPct > 0 && dailyProgressPct < 100 ? "progress-shimmer" : ""}`}
                      style={{
                        width: `${dailyProgressPct}%`,
                        background: dailyProgressPct >= 100
                          ? "linear-gradient(90deg, #22C55E 0%, #FFD700 100%)"
                          : "linear-gradient(90deg, #4A90D9 0%, #FFD700 100%)",
                        transition: reduceMotion ? "none" : "width 900ms var(--ease-out-emil)",
                      }}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/60">daily goal</p>
                  {historyLoading ? (
                    <span className="skeleton-shimmer rounded h-[10px] w-10 inline-block" aria-hidden="true" />
                  ) : (
                    <p className="font-mono text-[10px] tabular-nums text-cream/70">
                      {Math.min(todayCount, dailyGoal)} / {dailyGoal}
                    </p>
                  )}
                </div>
              </FeatureGate>
            </Link>

            {/* Secondary actions — 5 clean rows, not cards */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              <FeatureGate feature="learn.paths" compact>
                <Link
                  href="/learn/paths"
                  className="group flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-gold/30 transition-colors text-left"
                  aria-label="Subjects — learning paths"
                >
                  <BookOpen size={18} weight="regular" color="#3B82F6" aria-hidden="true" className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-syne font-semibold text-sm text-cream leading-tight">Subjects</p>
                    <p className="text-cream/55 text-[10px] font-mono">7 learning paths</p>
                  </div>
                  <ArrowRight size={14} weight="regular" aria-hidden="true" className="text-cream/40 group-hover:text-gold transition-colors" />
                </Link>
              </FeatureGate>

              <Link href="/learn/ninny" className="group flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-[#A855F7]/30 transition-colors">
                <PawPrint size={18} weight="fill" color="#A855F7" aria-hidden="true" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-sm text-cream leading-tight">Study with Ninny</p>
                  <p className="text-cream/55 text-[10px] font-mono">ai tutor</p>
                </div>
                <ArrowRight size={14} weight="regular" aria-hidden="true" className="text-cream/40 group-hover:text-[#A855F7] transition-colors" />
              </Link>

              <Link href="/learn/mastery" className="group flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-gold/30 transition-colors text-left">
                <Brain size={18} weight="fill" color="#FFD700" aria-hidden="true" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-sm text-cream leading-tight">Mastery Mode</p>
                  <p className="text-cream/55 text-[10px] font-mono">any exam · any topic</p>
                </div>
                <ArrowRight size={14} weight="regular" aria-hidden="true" className="text-cream/40 group-hover:text-gold transition-colors" />
              </Link>

              <FeatureGate feature="learn.vocab" compact>
                <Link href="/learn/vocab" className="group flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-[#4A90D9]/30 transition-colors text-left">
                  <Books size={18} weight="fill" color="#4A90D9" aria-hidden="true" className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-syne font-semibold text-sm text-cream leading-tight">Word Banks</p>
                    <p className="text-cream/55 text-[10px] font-mono">language vocab · aws · math · anything</p>
                  </div>
                  <ArrowRight size={14} weight="regular" aria-hidden="true" className="text-cream/40 group-hover:text-electric transition-colors" />
                </Link>
              </FeatureGate>

              <Link
                href="/learn/resume-coach"
                className="group flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-[6px] border border-white/[0.06] hover:bg-white/[0.03] hover:border-gold/30 transition-colors text-left"
                aria-label={isPro ? "Resume Coach — Pro feature" : "Resume Coach — Pro feature, locked"}
              >
                <Briefcase size={18} weight="fill" color="#FFD700" aria-hidden="true" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-sm text-cream leading-tight flex items-center gap-2 flex-wrap">
                    Resume Coach
                    {!isPro && (
                      <span className="inline-flex items-center gap-1 text-[8px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/30 whitespace-nowrap">
                        <Crown size={9} weight="fill" aria-hidden="true" />
                        Pro
                      </span>
                    )}
                  </p>
                  <p className="text-cream/55 text-[10px] font-mono">ninny critiques your resume</p>
                </div>
                <ArrowRight size={14} weight="regular" aria-hidden="true" className="text-cream/40 group-hover:text-gold transition-colors" />
              </Link>
            </div>
          </section>

          {/* ═══ 4. Two-column content area ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

            {/* ── LEFT (3/5): Subject mastery + missions ── */}
            <div className="lg:col-span-3 space-y-10">

              {/* SUBJECT MASTERY */}
              <FeatureGate feature="learn.subject_mastery" compact>
              <section className="animate-slide-up" style={delay("0.12s")}>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">MASTERY</h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">
                    {mastery.length} {mastery.length === 1 ? "subject" : "subjects"} · weakest first
                  </p>
                </div>

                {historyLoading ? (
                  /* No-flash: skeleton rows while history resolves so we never
                     show "No data yet" to a returning user mid-fetch. */
                  <ul className="space-y-2.5" aria-hidden="true">
                    {[0, 1, 2].map(i => (
                      <li key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 px-3">
                        <span className="skeleton-shimmer rounded-full w-[18px] h-[18px]" />
                        <div className="min-w-0 space-y-1.5">
                          <span className="skeleton-shimmer rounded h-3 w-24 block" />
                          <span className="skeleton-shimmer rounded-full h-1 w-full block" />
                        </div>
                        <span className="skeleton-shimmer rounded h-5 w-9" />
                      </li>
                    ))}
                  </ul>
                ) : mastery.length === 0 ? (
                  <div className="py-8 border-y border-white/[0.04] text-center">
                    <p className="text-cream/70 text-sm mb-3">No data yet. One quiz and this fills in.</p>
                    <Link href="/quiz" className="inline-block font-syne font-bold text-xs px-5 py-2 min-h-[44px] inline-flex items-center justify-center rounded-full border border-electric/50 text-electric hover:bg-electric/10 transition-colors">
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
                            className="press-feedback group grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 px-3 min-h-[44px] rounded-[4px] border border-transparent hover:border-white/[0.08] hover:bg-white/[0.02] transition-all"
                            aria-label={`${m.subject}: ${m.accuracy}% accuracy, ${m.correct} of ${m.answered} correct${isWeak ? ", weak subject" : ""}. Practice ${m.subject}.`}
                          >
                            <MasteryIcon size={18} weight="regular" color={color} aria-hidden="true" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <p className="font-syne font-semibold text-sm text-cream truncate">{m.subject}</p>
                                {isWeak && (
                                  <span className="font-mono text-[9px] uppercase tracking-wider text-red-400" aria-hidden="true">weak</span>
                                )}
                                <span className="font-mono text-[9px] text-cream/60 ml-auto tabular-nums" aria-hidden="true">
                                  {m.correct}/{m.answered}
                                </span>
                              </div>
                              {/* Accuracy bar — decorative; the row aria-label carries the numbers */}
                              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }} aria-hidden="true">
                                <div
                                  className="h-full"
                                  style={{
                                    width: `${m.accuracy}%`,
                                    background: `linear-gradient(90deg, ${color}70, ${color})`,
                                    transition: reduceMotion ? "none" : "width 900ms var(--ease-out-emil)",
                                  }}
                                />
                              </div>
                            </div>
                            <p className="font-bebas text-xl tabular-nums" style={{ color }} aria-hidden="true">
                              {m.accuracy}<span className="text-cream/60 text-xs">%</span>
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              </FeatureGate>

              {/* TODAY'S MISSIONS */}
              {missions.length > 0 && (
                <section className="animate-slide-up" style={delay("0.16s")}>
                  <div className="flex items-baseline justify-between mb-4">
                    <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">TODAY&rsquo;S MISSIONS</h2>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">resets 00:00</p>
                  </div>

                  <ul className="space-y-2">
                    {missions.map(m => {
                      const pct = Math.min((m.progress / m.target) * 100, 100);
                      const statusLabel = m.claimed ? "claimed" : m.completed ? "ready to claim" : "in progress";
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
                          aria-label={`${m.title}: ${m.progress} of ${m.target}, ${statusLabel}. Reward ${m.coinReward} Fangs.`}
                        >
                          {/* Accent bar on the left edge — 2px, not a stripe; contained within border-radius */}
                          <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${m.color}14`, border: `1px solid ${m.color}35` }}>
                            <span className="text-sm" aria-hidden="true">{m.icon}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <p className="font-syne font-semibold text-sm text-cream truncate">{m.title}</p>
                              {m.claimed && <span className="font-mono text-[9px] uppercase tracking-wider text-green-400" aria-hidden="true">claimed</span>}
                              {m.completed && !m.claimed && <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: m.color }} aria-hidden="true">ready</span>}
                            </div>
                            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }} aria-hidden="true">
                              <div
                                className={`h-full ${pct > 0 && pct < 100 && !m.claimed ? "progress-shimmer" : ""}`}
                                style={{
                                  width: `${pct}%`,
                                  background: `linear-gradient(90deg, ${m.color}70, ${m.color})`,
                                  transition: reduceMotion ? "none" : "width 800ms var(--ease-out-emil)",
                                }}
                              />
                            </div>
                          </div>

                          <div className="flex-shrink-0 text-right" aria-hidden="true">
                            <p className="font-bebas text-sm tabular-nums" style={{ color: m.color }}>
                              {m.progress}<span className="text-cream/60 text-xs">/{m.target}</span>
                            </p>
                            <p className="font-mono text-[9px] text-gold">+{m.coinReward}</p>
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
              <FeatureGate feature="learn.study_heatmap" compact>
              <section className="animate-slide-up" style={delay("0.12s")}>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">7-DAY ACTIVITY</h2>
                  {historyLoading ? (
                    <span className="skeleton-shimmer rounded h-[10px] w-16 inline-block" aria-hidden="true" />
                  ) : (
                    <p className="font-mono text-[10px] tabular-nums text-cream/60">{weekTotal} questions</p>
                  )}
                </div>

                {historyLoading ? (
                  /* No-flash: skeleton cells while history resolves so the
                     heatmap never paints a row of misleading zeros. */
                  <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className="aspect-square rounded-[3px] skeleton-shimmer" />
                    ))}
                  </div>
                ) : (
                  /* Color intensity alone fails SR + colorblind users, so the
                     grid is exposed as a single image with a full text summary,
                     and every cell carries its own date + count aria-label. */
                  <div
                    className="grid grid-cols-7 gap-1.5"
                    role="img"
                    aria-label={`Study activity, last 7 days: ${weekTotal} question${weekTotal === 1 ? "" : "s"} total. ${heatmap.map(d => `${d.label}${d.isToday ? " (today)" : ""}, ${d.count} question${d.count === 1 ? "" : "s"}`).join("; ")}.`}
                  >
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
                          className={`aspect-square rounded-[3px] flex flex-col items-center justify-center transition-transform ${reduceMotion ? "" : "hover:scale-110"}`}
                          style={{
                            background: intensity === 0
                              ? "rgba(255, 255, 255, 0.04)"
                              : `rgba(34, 197, 94, ${intensity})`,
                            border: d.isToday ? "1px solid rgba(255, 215, 0, 0.7)" : "1px solid rgba(255,255,255,0.04)",
                            boxShadow: d.isToday ? "0 0 8px rgba(255, 215, 0, 0.35)" : "none",
                          }}
                          title={`${d.label} · ${d.count} question${d.count === 1 ? "" : "s"}`}
                        >
                          <span className="font-mono text-[9px] leading-none" style={{ color: intensity > 0.5 ? "#fff" : "rgba(238,244,255,0.6)" }}>
                            {d.dow}
                          </span>
                          {d.count > 0 && (
                            <span className="font-bebas text-xs tabular-nums leading-none mt-0.5" style={{ color: intensity > 0.5 ? "#fff" : "rgba(238,244,255,0.85)" }}>
                              {d.count}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Heatmap legend — decorative scale key */}
                <div className="flex items-center justify-end gap-1.5 mt-3" aria-hidden="true">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-cream/60">less</span>
                  {[0.04, 0.18, 0.42, 0.72, 1].map((o, i) => (
                    <span key={i} className="w-2.5 h-2.5 rounded-[2px]" style={{
                      background: o < 0.1 ? "rgba(255, 255, 255, 0.04)" : `rgba(34, 197, 94, ${o})`,
                    }} />
                  ))}
                  <span className="font-mono text-[9px] uppercase tracking-wider text-cream/60">more</span>
                </div>
              </section>
              </FeatureGate>

              {/* RECENT LOG — clean list */}
              <FeatureGate feature="learn.recent_activity" compact>
              <section className="animate-slide-up" style={delay("0.18s")}>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">RECENT</h2>
                  <Link href="/quiz" className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/60 hover:text-electric transition-colors">
                    new →
                  </Link>
                </div>

                {historyLoading ? (
                  /* No-flash: skeleton rows so we never show "No quizzes yet"
                     to a user who has history while the fetch is in flight. */
                  <ul className="divide-y divide-white/[0.04]" aria-hidden="true">
                    {[0, 1, 2].map(i => (
                      <li key={i} className="flex items-center gap-3 py-3 -mx-2 px-2">
                        <span className="skeleton-shimmer rounded-full w-4 h-4" />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <span className="skeleton-shimmer rounded h-3 w-20 block" />
                          <span className="skeleton-shimmer rounded h-2 w-12 block" />
                        </div>
                        <span className="skeleton-shimmer rounded h-4 w-8" />
                      </li>
                    ))}
                  </ul>
                ) : recentActivity.length === 0 ? (
                  <div className="py-8 text-center border-y border-white/[0.04]">
                    <p className="text-cream/70 text-xs mb-3">No quizzes yet</p>
                    <Link href="/quiz" className="inline-block font-syne font-bold text-xs px-4 py-2 min-h-[44px] inline-flex items-center justify-center rounded-full border border-electric/50 text-electric hover:bg-electric/10 transition-colors">
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
                          <Link
                            href={`/quiz?subject=${encodeURIComponent(entry.subject)}`}
                            className="flex items-center gap-3 py-3 min-h-[44px] hover:bg-white/[0.02] transition-colors -mx-2 px-2 rounded-[4px]"
                            aria-label={`${entry.subject}, ${pct}% accuracy, ${timeAgo(entry.completed_at)}, earned ${entry.coins_earned} Fangs. Practice ${entry.subject}.`}
                          >
                            <RecentIcon size={16} weight="regular" color={color} aria-hidden="true" />
                            <div className="flex-1 min-w-0" aria-hidden="true">
                              <p className="text-cream text-xs font-semibold truncate">{entry.subject}</p>
                              <p className="text-cream/60 text-[10px] font-mono">{timeAgo(entry.completed_at)}</p>
                            </div>
                            <div className="text-right" aria-hidden="true">
                              <p className="font-bebas text-sm tabular-nums" style={{ color }}>
                                {pct}<span className="text-cream/60 text-[10px]">%</span>
                              </p>
                              <p className="font-mono text-[9px] text-gold">+{entry.coins_earned}</p>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              </FeatureGate>

            </div>
          </div>

        </div>
      </div>
      </FeatureGate>

    </ProtectedRoute>
  );
}
