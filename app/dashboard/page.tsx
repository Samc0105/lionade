"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getRecentActivity, getSubjectStats, getQuizHistory } from "@/lib/db";
import { getLevelProgress, formatCoins, SUBJECT_ICONS, XP_PER_LEVEL } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";

function ActivityIcon(type: string) {
  const map: Record<string, string> = {
    quiz_reward: "\u2705", duel_win: "\u2694\uFE0F", duel_loss: "\u{1F480}",
    streak_bonus: "\u{1F525}", badge_bonus: "\u{1F396}\uFE0F", signup_bonus: "\u{1F389}",
  };
  return map[type] ?? "\u{1FA99}";
}

// Mock study history for fallback
const MOCK_SESSIONS = [
  { mode: "Daily Quiz", subject: "Math", score: "8/10", accuracy: 80, coins: 240, date: "Today, 2:30 PM" },
  { mode: "Subject", subject: "Science", score: "7/10", accuracy: 70, coins: 175, date: "Today, 11:15 AM" },
  { mode: "Duel", subject: "Coding", score: "Won 6-4", accuracy: 60, coins: 500, date: "Yesterday, 8:45 PM" },
  { mode: "Daily Quiz", subject: "Finance", score: "9/10", accuracy: 90, coins: 310, date: "Yesterday, 3:00 PM" },
  { mode: "Subject", subject: "Languages", score: "6/10", accuracy: 60, coins: 120, date: "Feb 18, 10:30 AM" },
];

// Mock subject data for fallback
const MOCK_SUBJECTS = [
  { subject: "Math", questionsAnswered: 120, correctAnswers: 96, coinsEarned: 2880 },
  { subject: "Science", questionsAnswered: 85, correctAnswers: 68, coinsEarned: 1700 },
  { subject: "Coding", questionsAnswered: 60, correctAnswers: 51, coinsEarned: 1530 },
  { subject: "Finance", questionsAnswered: 45, correctAnswers: 38, coinsEarned: 1140 },
  { subject: "Languages", questionsAnswered: 30, correctAnswers: 21, coinsEarned: 630 },
];

export default function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const [activity, setActivity] = useState<{ amount: number; type: string; description: string | null; created_at: string }[]>([]);
  const [subjectStats, setSubjectStats] = useState<{ subject: string; questionsAnswered: number; correctAnswers: number; coinsEarned: number }[]>([]);
  const [quizHistory, setQuizHistory] = useState<{ id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; completed_at: string }[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dailyDone] = useState(false); // mock: user hasn't done daily quiz yet

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

  if (!user) return null;

  const { level, progress, xpToNext } = getLevelProgress(user.xp);
  const quizzesToNextLevel = Math.ceil(xpToNext / 100); // ~100 XP per quiz avg
  const todayCoins = activity
    .filter(a => {
      const d = new Date(a.created_at);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    })
    .reduce((sum, a) => sum + (a.amount > 0 ? a.amount : 0), 0);

  // Use real data if available, mock as fallback
  const displaySubjects = subjectStats.length > 0 ? subjectStats : MOCK_SUBJECTS;
  const hasRealHistory = quizHistory.length > 0;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16 pb-20 md:pb-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

          {/* ═══ Section A: Performance Snapshot ═══ */}
          <div className="mb-6 animate-slide-up">
            {/* Welcome */}
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-tight">
              Welcome back, <span className="text-electric">{user.username}</span>
            </h1>
            <p className="text-cream/40 text-sm mt-0.5">Clock in and keep your streak alive.</p>

            {/* Stats Strip */}
            <div className="card mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-base">&#x1FA99;</span>
                  </div>
                  <div>
                    <p className="font-bebas text-2xl text-gold leading-none">{formatCoins(user.coins)}</p>
                    <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Coins</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-base">&#x1F525;</span>
                  </div>
                  <div>
                    <p className="font-bebas text-2xl text-orange-400 leading-none">{user.streak}</p>
                    <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Streak</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-electric/10 border border-electric/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-base">&#x26A1;</span>
                  </div>
                  <div>
                    <p className="font-bebas text-2xl text-electric leading-none">LVL {level}</p>
                    <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Level</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-electric/10 border border-electric/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-base">&#x1F4CA;</span>
                  </div>
                  <div>
                    <p className="font-bebas text-2xl text-cream leading-none">{subjectStats.length || MOCK_SUBJECTS.length}</p>
                    <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Subjects</p>
                  </div>
                </div>
              </div>

              {/* Micro insights */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 pt-3 border-t border-electric/10">
                <p className="text-cream/40 text-xs">
                  <span className="text-gold">+{todayCoins}</span> coins today
                </p>
                <p className="text-cream/40 text-xs">
                  <span className="text-electric">~{quizzesToNextLevel}</span> quizzes to next level
                </p>
              </div>
            </div>

            {/* XP Bar */}
            <div className="card mt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-electric/20 border border-electric/40 flex items-center justify-center">
                    <span className="font-bebas text-sm text-electric">{level}</span>
                  </div>
                  <div>
                    <p className="font-bold text-cream text-xs">Level {level}</p>
                    <p className="text-cream/40 text-[10px]">{user.xp.toLocaleString()} XP total</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bebas text-lg text-electric">{xpToNext} XP</p>
                  <p className="text-cream/40 text-[10px]">to Level {level + 1}</p>
                </div>
              </div>
              <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${progress}%`, background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 8px #4A90D960" }} />
              </div>
              <p className="text-cream/30 text-[10px] mt-1.5 text-right">{progress.toFixed(0)}% to next level</p>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              {/* ═══ Section B: Today's Plan ═══ */}
              <div className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
                <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">TODAY&apos;S PLAN</h2>
                <div className="card">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xl">&#x1F3AF;</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-cream text-sm">Daily Challenge</p>
                      <p className="text-cream/40 text-xs mt-0.5">
                        {dailyDone
                          ? "Completed! Score 100% for a streak bonus."
                          : "Complete today\u2019s quiz to maintain your streak and earn bonus coins."}
                      </p>
                      <Link href="/quiz">
                        <button className="mt-3 font-syne font-bold text-sm px-5 py-2 rounded-lg transition-all duration-200
                          active:scale-95 text-navy bg-electric hover:bg-electric-light
                          shadow-sm shadow-electric/20 hover:shadow-electric/40">
                          {dailyDone ? "Practice a Subject" : "Start Daily Quiz"}
                        </button>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              {/* ═══ Section C: Subject Progress ═══ */}
              <div className="animate-slide-up" style={{ animationDelay: "0.15s" }}>
                <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">YOUR SUBJECTS</h2>
                <div className="card space-y-4">
                  {displaySubjects.slice(0, 6).map((stat) => {
                    const accuracy = stat.questionsAnswered > 0
                      ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100)
                      : 0;
                    const icon = SUBJECT_ICONS[stat.subject as keyof typeof SUBJECT_ICONS] ?? "\u{1F4DA}";
                    return (
                      <div key={stat.subject} className="flex items-center gap-3">
                        <span className="text-lg flex-shrink-0">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-cream text-sm">{stat.subject}</span>
                            <span className="text-cream/40 text-xs">{accuracy}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${accuracy}%`,
                                background: accuracy >= 80 ? "#2ECC71" : accuracy >= 60 ? "#E67E22" : "#E74C3C",
                              }} />
                          </div>
                        </div>
                        <Link href="/learn" className="flex-shrink-0">
                          <button className="text-electric text-xs font-semibold hover:text-electric-light transition-colors px-2 py-1 rounded hover:bg-electric/5">
                            Continue
                          </button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ═══ Section D: Study History ═══ */}
              <div className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
                <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">RECENT SESSIONS</h2>
                <div className="card">
                  {hasRealHistory ? (
                    <div className="space-y-3">
                      {quizHistory.map((session, i) => {
                        const accuracy = session.total_questions > 0
                          ? Math.round((session.correct_answers / session.total_questions) * 100)
                          : 0;
                        const icon = SUBJECT_ICONS[session.subject as keyof typeof SUBJECT_ICONS] ?? "\u{1F4DA}";
                        return (
                          <div key={session.id} className="flex items-center gap-3 py-2 border-b border-electric/10 last:border-0">
                            <span className="text-lg flex-shrink-0">{icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-cream text-xs font-semibold truncate">
                                {session.subject} Quiz
                              </p>
                              <p className="text-cream/30 text-[10px]">
                                {new Date(session.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-cream text-xs font-semibold">{session.correct_answers}/{session.total_questions} <span className="text-cream/40">({accuracy}%)</span></p>
                              <p className="text-gold text-[10px] font-bold">+{session.coins_earned}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {MOCK_SESSIONS.map((session, i) => (
                        <div key={i} className="flex items-center gap-3 py-2 border-b border-electric/10 last:border-0">
                          <div className="w-8 h-8 rounded-lg bg-electric/10 border border-electric/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs">
                              {session.mode === "Daily Quiz" ? "\u{1F9E0}" : session.mode === "Duel" ? "\u2694\uFE0F" : "\u{1F4DA}"}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-cream text-xs font-semibold truncate">
                              {session.mode} &middot; {session.subject}
                            </p>
                            <p className="text-cream/30 text-[10px]">{session.date}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-cream text-xs font-semibold">{session.score}</p>
                            <p className="text-gold text-[10px] font-bold">+{session.coins}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-6">

              {/* ═══ Section E: Lionade Insight (Ninny placeholder) ═══ */}
              <div className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
                <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">LIONADE INSIGHT</h2>
                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">&#x1F9E0;</span>
                    <p className="font-bold text-cream text-sm">Ninny&apos;s Notes</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-electric text-xs mt-0.5">&#x25CF;</span>
                      <p className="text-cream/60 text-xs">You perform better in the morning. Try studying before noon.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-electric text-xs mt-0.5">&#x25CF;</span>
                      <p className="text-cream/60 text-xs">You missed 3 questions on Algebra this week. Review those topics.</p>
                    </div>
                  </div>
                  <button
                    disabled
                    className="mt-4 w-full text-sm font-semibold py-2 rounded-lg border border-electric/20
                      text-cream/30 bg-white/5 cursor-not-allowed"
                    title="Coming soon"
                  >
                    Study with Ninny (Soon)
                  </button>
                </div>
              </div>

              {/* Recent Activity (coin transactions) */}
              <div className="animate-slide-up" style={{ animationDelay: "0.15s" }}>
                <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">RECENT ACTIVITY</h2>
                {activity.length > 0 ? (
                  <div className="card space-y-3">
                    {activity.map((item, i) => (
                      <div key={i} className="flex items-center gap-3 py-2 border-b border-electric/10 last:border-0">
                        <span className="text-xl flex-shrink-0">{ActivityIcon(item.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-xs font-semibold truncate">
                            {item.description ?? item.type.replace(/_/g, " ")}
                          </p>
                          <p className="text-cream/30 text-xs">
                            {new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                        </div>
                        <span className={`text-xs font-bold flex-shrink-0 ${item.amount > 0 ? "text-gold" : "text-red-400"}`}>
                          {item.amount > 0 ? `+${item.amount}` : item.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="card text-center py-6">
                    <p className="text-cream/40 text-sm">Activity will show here after your first quiz.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
