"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getRecentActivity, getSubjectStats, getQuizHistory } from "@/lib/db";
import {
  getLevelProgress,
  formatCoins,
  SUBJECT_ICONS,
  SUBJECT_COLORS,
  XP_PER_LEVEL,
} from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";

function ActivityIcon(type: string) {
  const map: Record<string, string> = {
    quiz_reward: "\u2705",
    duel_win: "\u2694\uFE0F",
    duel_loss: "\u{1F480}",
    streak_bonus: "\u{1F525}",
    badge_bonus: "\u{1F396}\uFE0F",
    signup_bonus: "\u{1F389}",
  };
  return map[type] ?? "\u{1FA99}";
}

const MOCK_SUBJECTS = [
  { subject: "Math", questionsAnswered: 120, correctAnswers: 96, coinsEarned: 2880 },
  { subject: "Science", questionsAnswered: 85, correctAnswers: 68, coinsEarned: 1700 },
  { subject: "Coding", questionsAnswered: 60, correctAnswers: 51, coinsEarned: 1530 },
  { subject: "Finance", questionsAnswered: 45, correctAnswers: 38, coinsEarned: 1140 },
  { subject: "Languages", questionsAnswered: 30, correctAnswers: 21, coinsEarned: 630 },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Let\u2019s build momentum.";
  if (h < 18) return "Keep the streak alive.";
  return "One more win before midnight.";
}

export default function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const [activity, setActivity] = useState<
    { amount: number; type: string; description: string | null; created_at: string }[]
  >([]);
  const [subjectStats, setSubjectStats] = useState<
    { subject: string; questionsAnswered: number; correctAnswers: number; coinsEarned: number }[]
  >([]);
  const [quizHistory, setQuizHistory] = useState<
    { id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; completed_at: string }[]
  >([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dailyDone] = useState(false);
  const [xpMounted, setXpMounted] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getRecentActivity(user.id, 5).catch(() => []),
      getSubjectStats(user.id).catch(() => []),
      getQuizHistory(user.id, 5).catch(() => []),
    ]).then(([act, stats, history]) => {
      setActivity(act);
      setSubjectStats(stats);
      setQuizHistory(history);
      setLoadingData(false);
    });
    refreshUser();
  }, [user?.id]);

  /* Animate XP bar fill on mount */
  useEffect(() => {
    const t = setTimeout(() => setXpMounted(true), 200);
    return () => clearTimeout(t);
  }, []);

  if (!user) return null;

  const { level, progress, xpToNext } = getLevelProgress(user.xp);
  const currentXp = user.xp % XP_PER_LEVEL;
  const todayCoins = activity
    .filter((a) => new Date(a.created_at).toDateString() === new Date().toDateString())
    .reduce((sum, a) => sum + (a.amount > 0 ? a.amount : 0), 0);
  const displaySubjects = subjectStats.length > 0 ? subjectStats : MOCK_SUBJECTS;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16 pb-20 md:pb-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* ═══ 1) Hero Header ═══ */}
          <div className="mb-6 animate-slide-up">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-tight">
                  Welcome back,{" "}
                  <span className="text-electric">{user.username}</span>
                </h1>
                <p className="text-cream/40 text-sm mt-1">{getGreeting()}</p>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
                <p className="text-cream/25 text-xs">{today}</p>
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold
                    px-3 py-1 rounded-full bg-electric/10 text-electric/80 border border-electric/15"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-electric animate-pulse-glow" />
                  Ready to study
                </span>
              </div>
            </div>
          </div>

          {/* ═══ 2) Stat Pills ═══ */}
          <div
            className="flex flex-wrap gap-2.5 mb-6 animate-slide-up"
            style={{ animationDelay: "0.05s" }}
          >
            <div
              className="flex items-center gap-2 px-3.5 py-2 rounded-full
                bg-white/[0.03] hover:bg-white/[0.06] hover:-translate-y-[1px] hover:brightness-110
                transition-all duration-200 ease-out border border-white/[0.06]"
            >
              <span className="text-sm">&#x1FA99;</span>
              <span className="font-bebas text-lg text-gold leading-none">
                {formatCoins(user.coins)}
              </span>
              <span className="text-cream/25 text-[10px]">+{todayCoins} today</span>
            </div>

            <div
              className="flex items-center gap-2 px-3.5 py-2 rounded-full
                bg-white/[0.03] hover:bg-white/[0.06] hover:-translate-y-[1px] hover:brightness-110
                transition-all duration-200 ease-out border border-white/[0.06]"
            >
              <span className="text-sm">&#x1F525;</span>
              <span className="font-bebas text-lg text-orange-400 leading-none">
                {user.streak}
              </span>
              <span className="text-cream/25 text-[10px]">
                Best: {user.streak} days
              </span>
            </div>

            <div
              className="flex items-center gap-2 px-3.5 py-2 rounded-full
                bg-white/[0.03] hover:bg-white/[0.06] hover:-translate-y-[1px] hover:brightness-110
                transition-all duration-200 ease-out border border-white/[0.06]"
            >
              <span className="text-sm">&#x26A1;</span>
              <span className="font-bebas text-lg text-electric leading-none">
                Lvl {level}
              </span>
              <span className="text-cream/25 text-[10px]">{xpToNext} XP to next</span>
            </div>

            <div
              className="flex items-center gap-2 px-3.5 py-2 rounded-full
                bg-white/[0.03] hover:bg-white/[0.06] hover:-translate-y-[1px] hover:brightness-110
                transition-all duration-200 ease-out border border-white/[0.06]"
            >
              <span className="text-sm">&#x1F4DA;</span>
              <span className="font-bebas text-lg text-cream leading-none">
                {displaySubjects.length}
              </span>
              <span className="text-cream/25 text-[10px]">
                {displaySubjects.length} active
              </span>
            </div>
          </div>

          {/* ═══ 3) XP Progress (thicker, animated fill) ═══ */}
          <div
            className="mb-8 animate-slide-up"
            style={{ animationDelay: "0.08s" }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-cream/50 text-xs font-semibold">
                  Level {level}
                </span>
                <span className="text-cream/20 text-[10px]">
                  {currentXp.toLocaleString()} / {XP_PER_LEVEL.toLocaleString()} XP
                </span>
              </div>
              <span className="text-cream/25 text-[10px]">
                {progress.toFixed(0)}% &bull; {xpToNext} XP to Level {level + 1}
              </span>
            </div>
            <div className="w-full h-3 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: xpMounted ? `${Math.max(progress, 2)}%` : "0%",
                  background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)",
                  boxShadow: "0 0 10px #4A90D950",
                }}
              />
            </div>
          </div>

          {/* ═══ 4) Mission Hero (centerpiece) ═══ */}
          <div
            className="rounded-2xl p-6 sm:p-8 mb-8 animate-slide-up relative overflow-hidden
              transition-all duration-300 hover:brightness-[1.03] idle-glow-mission periodic-pulse"
            style={{
              background:
                "linear-gradient(135deg, #0d1528 0%, #0a1020 50%, #0d1528 100%)",
              boxShadow:
                "0 0 0 1px rgba(74,144,217,0.1), 0 8px 32px rgba(0,0,0,0.3)",
              animationDelay: "0.1s",
            }}
          >
            {/* Decorative accent */}
            <div
              className="absolute top-0 right-0 w-56 h-56 rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(74,144,217,0.06), transparent 70%)",
              }}
            />

            <div className="relative flex items-start gap-5">
              <div
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gold/10 flex items-center justify-center flex-shrink-0"
                style={{ boxShadow: "0 0 24px rgba(255,215,0,0.06)" }}
              >
                <span className="text-3xl sm:text-4xl">&#x1F3AF;</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bebas text-2xl sm:text-3xl text-cream tracking-wider">
                  TODAY&apos;S MISSION
                </p>
                <p className="text-cream/70 text-sm sm:text-base mt-0.5">
                  Complete Daily Quiz
                </p>
                <p className="text-cream/30 text-xs mt-1">
                  Earn +10 coins &bull; Protect your streak
                </p>

                <div className="flex flex-wrap items-center gap-4 mt-5">
                  <Link href="/quiz">
                    <button
                      className="font-syne font-bold text-sm px-6 py-2.5 rounded-lg transition-all duration-200
                        active:scale-95 text-navy bg-electric hover:bg-electric-light cta-pulse"
                    >
                      {dailyDone ? "Practice a Subject" : "Start Daily Quiz"}
                    </button>
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-cream/25 text-xs font-semibold">
                      {dailyDone ? "1" : "0"}/1
                    </span>
                    <span className="text-cream/15 text-[10px]">
                      &bull; Resets in 14h
                    </span>
                  </div>
                </div>

                <p className="text-cream/15 text-[10px] mt-3">
                  Coins will unlock rewards soon.
                </p>
              </div>
            </div>
          </div>

          {/* ═══ 5) Continue Shelf ═══ */}
          <div
            className="mb-8 animate-slide-up"
            style={{ animationDelay: "0.15s" }}
          >
            <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">
              CONTINUE
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
              {/* Daily Quiz card */}
              {!dailyDone && (
                <Link href="/quiz" className="flex-shrink-0">
                  <div
                    className="w-36 rounded-xl p-3.5 transition-all duration-200 ease-out
                      hover:brightness-110 hover:-translate-y-1 hover:scale-[1.03]"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(74,144,217,0.1) 0%, rgba(74,144,217,0.04) 100%)",
                      border: "1px solid rgba(74,144,217,0.12)",
                    }}
                  >
                    <span className="text-2xl">&#x1F9E0;</span>
                    <p className="font-semibold text-cream text-xs mt-2">
                      Daily Quiz
                    </p>
                    <p className="text-cream/25 text-[10px] mt-0.5">
                      10 questions
                    </p>
                  </div>
                </Link>
              )}

              {/* Subject cards */}
              {displaySubjects.slice(0, 4).map((stat) => {
                const accuracy =
                  stat.questionsAnswered > 0
                    ? Math.round(
                        (stat.correctAnswers / stat.questionsAnswered) * 100
                      )
                    : 0;
                const icon =
                  SUBJECT_ICONS[
                    stat.subject as keyof typeof SUBJECT_ICONS
                  ] ?? "\u{1F4DA}";
                const color =
                  SUBJECT_COLORS[
                    stat.subject as keyof typeof SUBJECT_COLORS
                  ] ?? "#4A90D9";
                return (
                  <Link
                    key={stat.subject}
                    href="/learn"
                    className="flex-shrink-0"
                  >
                    <div
                      className="w-36 rounded-xl p-3.5 transition-all duration-200 ease-out
                        hover:brightness-110 hover:-translate-y-1 hover:scale-[1.03]"
                      style={{
                        background: `linear-gradient(135deg, ${color}12 0%, ${color}06 100%)`,
                        border: `1px solid ${color}15`,
                      }}
                    >
                      <span className="text-2xl">{icon}</span>
                      <p className="font-semibold text-cream text-xs mt-2">
                        {stat.subject}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${accuracy}%`,
                              background: color,
                            }}
                          />
                        </div>
                        <span className="text-cream/35 text-[9px]">
                          {accuracy}%
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* ═══ 6) Two-Column Lower ═══ */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: Subjects */}
            <div
              className="lg:col-span-2 animate-slide-up"
              style={{ animationDelay: "0.2s" }}
            >
              <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">
                YOUR SUBJECTS
              </h2>
              <div className="space-y-0.5">
                {displaySubjects.slice(0, 6).map((stat) => {
                  const accuracy =
                    stat.questionsAnswered > 0
                      ? Math.round(
                          (stat.correctAnswers / stat.questionsAnswered) * 100
                        )
                      : 0;
                  const icon =
                    SUBJECT_ICONS[
                      stat.subject as keyof typeof SUBJECT_ICONS
                    ] ?? "\u{1F4DA}";
                  return (
                    <div
                      key={stat.subject}
                      className="flex items-center gap-3 py-3 px-4 rounded-xl
                        hover:bg-white/[0.03] transition-all duration-200 ease-out"
                    >
                      <span className="text-lg flex-shrink-0">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-cream text-sm">
                            {stat.subject}
                          </span>
                          <span className="text-cream/40 text-xs">
                            {accuracy}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${accuracy}%`,
                              background:
                                accuracy >= 80
                                  ? "#2ECC71"
                                  : accuracy >= 60
                                  ? "#E67E22"
                                  : "#E74C3C",
                            }}
                          />
                        </div>
                      </div>
                      <Link href="/learn" className="flex-shrink-0">
                        <button
                          className="text-electric text-xs font-semibold hover:text-electric-light
                            transition-colors px-2 py-1 rounded hover:bg-electric/5"
                        >
                          Continue
                        </button>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: This Week + Activity + Ninny */}
            <div className="space-y-6">
              {/* This Week (gamification tease) */}
              <div
                className="animate-slide-up"
                style={{ animationDelay: "0.18s" }}
              >
                <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">
                  THIS WEEK
                </h2>
                <div
                  className="rounded-xl p-4 space-y-2.5"
                  style={{
                    background:
                      "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)",
                    border: "1px solid rgba(74,144,217,0.08)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-cream/40 text-xs">Your rank</span>
                    <span className="text-cream/20 text-xs font-semibold">&mdash; (soon)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-cream/40 text-xs">Top player</span>
                    <span className="text-cream/20 text-xs font-semibold">&mdash; (soon)</span>
                  </div>
                  <p className="text-cream/15 text-[10px] pt-1">
                    Win duels to climb the leaderboard.
                  </p>
                </div>
              </div>

              {/* Recent Activity */}
              <div
                className="animate-slide-up"
                style={{ animationDelay: "0.22s" }}
              >
                <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">
                  RECENT ACTIVITY
                </h2>
                {activity.length > 0 ? (
                  <div className="space-y-0.5">
                    {activity.map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 py-2.5 px-3 rounded-lg
                          hover:bg-white/[0.03] transition-all duration-200 ease-out"
                      >
                        <span className="text-lg flex-shrink-0">
                          {ActivityIcon(item.type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-xs font-semibold truncate">
                            {item.description ?? item.type.replace(/_/g, " ")}
                          </p>
                          <p className="text-cream/25 text-[10px]">
                            {new Date(item.created_at).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" }
                            )}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-bold flex-shrink-0 ${
                            item.amount > 0 ? "text-gold" : "text-red-400"
                          }`}
                        >
                          {item.amount > 0 ? `+${item.amount}` : item.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="rounded-xl p-6 text-center"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(13,21,40,0.5) 0%, rgba(10,16,32,0.5) 100%)",
                      border: "1px solid rgba(74,144,217,0.06)",
                    }}
                  >
                    <span className="text-3xl block mb-2">&#x1FA99;</span>
                    <p className="font-bebas text-base text-cream/50 tracking-wider">
                      No activity yet
                    </p>
                    <p className="text-cream/25 text-xs mt-1 mb-4 leading-relaxed">
                      Take your first quiz to start tracking progress.
                    </p>
                    <Link href="/quiz">
                      <button
                        className="font-syne font-semibold text-xs px-4 py-2 rounded-lg
                          transition-all duration-200 active:scale-95
                          border border-electric/30 text-electric hover:bg-electric/10"
                      >
                        Start Quiz
                      </button>
                    </Link>
                  </div>
                )}
              </div>

              {/* Ninny's Notes */}
              <div
                className="animate-slide-up"
                style={{ animationDelay: "0.26s" }}
              >
                <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">
                  NINNY&apos;S NOTES
                </h2>
                <div
                  className="rounded-xl p-4 idle-glow-ninny"
                  style={{
                    background:
                      "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)",
                    border: "1px solid rgba(74,144,217,0.08)",
                  }}
                >
                  <div className="space-y-2.5 mb-4">
                    <div className="flex items-start gap-2">
                      <span className="text-electric text-[10px] mt-0.5 flex-shrink-0">
                        &#x25CF;
                      </span>
                      <p className="text-cream/50 text-xs leading-relaxed">
                        You perform better in the morning. Try studying before
                        noon.
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-electric text-[10px] mt-0.5 flex-shrink-0">
                        &#x25CF;
                      </span>
                      <p className="text-cream/50 text-xs leading-relaxed">
                        Science accuracy up 12% this week. Keep it up.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    <button
                      disabled
                      className="text-[11px] font-semibold py-1.5 px-3 rounded-lg
                        border border-electric/15 text-cream/25 bg-white/[0.03] cursor-not-allowed"
                    >
                      Review Weak Spot (Soon)
                    </button>
                    <button
                      disabled
                      className="text-[11px] font-semibold py-1.5 px-3 rounded-lg
                        border border-electric/15 text-cream/25 bg-white/[0.03] cursor-not-allowed"
                    >
                      Ask Ninny (Soon)
                    </button>
                  </div>

                  <p className="text-cream/15 text-[10px] italic">
                    Ninny is analyzing your progress&hellip;
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
