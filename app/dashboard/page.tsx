"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getLeaderboard, getRecentActivity, getSubjectStats } from "@/lib/db";
import { getLevelProgress, formatCoins, SUBJECT_ICONS } from "@/lib/mockData";
import LeaderboardRow from "@/components/LeaderboardRow";
import ProtectedRoute from "@/components/ProtectedRoute";
import type { LeaderboardEntry } from "@/types";

function ActivityIcon(type: string) {
  const map: Record<string, string> = {
    quiz_reward: "\u2705", duel_win: "\u2694\uFE0F", duel_loss: "\u{1F480}",
    streak_bonus: "\u{1F525}", badge_bonus: "\u{1F396}\uFE0F", signup_bonus: "\u{1F389}",
  };
  return map[type] ?? "\u{1FA99}";
}

export default function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activity, setActivity] = useState<{ amount: number; type: string; description: string | null; created_at: string }[]>([]);
  const [subjectStats, setSubjectStats] = useState<{ subject: string; questionsAnswered: number; correctAnswers: number; coinsEarned: number }[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getLeaderboard(5).catch(() => []),
      getRecentActivity(user.id, 5).catch(() => []),
      getSubjectStats(user.id).catch(() => []),
    ]).then(([lb, act, stats]) => {
      setLeaderboard(lb.map((e) => ({
        rank: e.rank,
        user: {
          id: e.user_id, username: e.username, displayName: e.username,
          avatar: e.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${e.username}&backgroundColor=4A90D9`,
          coins: e.coins_this_week, streak: e.streak, maxStreak: e.streak,
          xp: 0, level: e.level, badges: [], subjectStats: [], joinedAt: "",
        },
        coinsThisWeek: e.coins_this_week,
        streak: e.streak,
        change: "same" as const,
      })));
      setActivity(act);
      setSubjectStats(stats);
      setLoadingData(false);
    });

    refreshUser();
  }, [user?.id]);

  if (!user) return null;

  const { level, progress, xpToNext } = getLevelProgress(user.xp);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16 pb-20 md:pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

          {/* Welcome Header — compact */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6 animate-slide-up">
            <div>
              <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-tight">
                Welcome back, <span className="text-electric">{user.username}</span>
              </h1>
              <p className="text-cream/40 text-sm mt-0.5">Clock in and keep your streak alive.</p>
            </div>
            <Link href="/quiz" className="hidden sm:block">
              <button className="font-syne font-bold text-sm px-5 py-2.5 rounded-xl transition-all duration-200
                active:scale-95 text-navy bg-electric hover:bg-electric-light
                shadow-md shadow-electric/30 hover:shadow-electric/50">
                Start Today&apos;s Quiz
              </button>
            </Link>
          </div>

          {/* Stats Strip — single container, 4 inline stats */}
          <div className="card mb-6 animate-slide-up" style={{ animationDelay: "0.1s" }}>
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
                  <p className="font-bebas text-2xl text-cream leading-none">{subjectStats.length}</p>
                  <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Subjects</p>
                </div>
              </div>
            </div>
          </div>

          {/* XP Bar */}
          <div className="card mb-6 animate-slide-up" style={{ animationDelay: "0.15s" }}>
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
                style={{ width: `${progress}%`, background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 12px #4A90D980" }} />
            </div>
            <p className="text-cream/30 text-[10px] mt-1.5 text-right">{progress.toFixed(0)}% to next level</p>
          </div>

          {/* Grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              {/* Quick Actions — 3 big tiles */}
              <div>
                <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">QUICK ACTIONS</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Link href="/learn">
                    <div className="card-hover p-5 rounded-xl group cursor-pointer text-center">
                      <span className="text-3xl group-hover:scale-110 transition-transform duration-300 inline-block mb-2">&#x1F4DA;</span>
                      <p className="font-bebas text-xl text-cream tracking-wider">Learn</p>
                      <p className="text-cream/40 text-xs mt-0.5">Daily quiz + subjects</p>
                    </div>
                  </Link>
                  <Link href="/compete">
                    <div className="card-hover p-5 rounded-xl group cursor-pointer text-center">
                      <span className="text-3xl group-hover:scale-110 transition-transform duration-300 inline-block mb-2">&#x2694;&#xFE0F;</span>
                      <p className="font-bebas text-xl text-cream tracking-wider">Compete</p>
                      <p className="text-cream/40 text-xs mt-0.5">Duel + Blitz + leaderboard</p>
                    </div>
                  </Link>
                  <Link href="/learn">
                    <div className="card-hover p-5 rounded-xl group cursor-pointer text-center">
                      <span className="text-3xl group-hover:scale-110 transition-transform duration-300 inline-block mb-2">&#x1F4D6;</span>
                      <p className="font-bebas text-xl text-cream tracking-wider">Library</p>
                      <p className="text-cream/40 text-xs mt-0.5">Community study materials</p>
                    </div>
                  </Link>
                </div>
              </div>

              {/* Subject Stats */}
              {subjectStats.length > 0 && (
                <div>
                  <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">SUBJECT MASTERY</h2>
                  <div className="card space-y-4">
                    {subjectStats.map((stat) => {
                      const accuracy = stat.questionsAnswered > 0
                        ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100)
                        : 0;
                      return (
                        <div key={stat.subject}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{SUBJECT_ICONS[stat.subject as keyof typeof SUBJECT_ICONS] ?? "\u{1F4DA}"}</span>
                              <span className="font-semibold text-cream text-sm">{stat.subject}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-cream/50">
                              <span>{accuracy}% accuracy</span>
                              <span className="text-gold">&#x1FA99; {formatCoins(stat.coinsEarned)}</span>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${accuracy}%`, background: accuracy >= 80 ? "#2ECC71" : accuracy >= 60 ? "#E67E22" : "#E74C3C" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {subjectStats.length === 0 && !loadingData && (
                <div className="card text-center py-10">
                  <p className="text-4xl mb-3">&#x1F9E0;</p>
                  <p className="font-bebas text-2xl text-cream tracking-wider mb-2">No quizzes yet</p>
                  <p className="text-cream/40 text-sm mb-4">Take your first quiz to start tracking mastery</p>
                  <Link href="/quiz"><button className="btn-primary px-6 py-2.5 text-sm">Start a Quiz</button></Link>
                </div>
              )}
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* Leaderboard */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bebas text-xl text-cream tracking-wider">TOP EARNERS</h2>
                  <Link href="/leaderboard" className="text-electric text-xs font-semibold hover:text-electric-light">Full board &rarr;</Link>
                </div>
                {loadingData ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />
                    ))}
                  </div>
                ) : leaderboard.length > 0 ? (
                  <div className="space-y-2">
                    {leaderboard.map((entry, i) => (
                      <LeaderboardRow key={entry.rank} entry={entry}
                        isCurrentUser={entry.user.id === user.id}
                        animationDelay={i * 80} />
                    ))}
                  </div>
                ) : (
                  <div className="card text-center py-6">
                    <p className="text-cream/40 text-sm">No leaderboard data yet.<br />Be the first to earn coins!</p>
                  </div>
                )}
              </div>

              {/* Activity */}
              <div>
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

              {/* Daily Challenge */}
              <div className="rounded-xl p-5 text-center"
                style={{ background: "linear-gradient(135deg, #FFD70020 0%, #B8960C10 100%)", border: "1px solid #FFD70040" }}>
                <div className="text-3xl mb-2 animate-float">&#x1F3AF;</div>
                <p className="font-bebas text-lg text-gold tracking-wider mb-1">DAILY CHALLENGE</p>
                <p className="text-cream/60 text-xs mb-3">Score 100% on today&apos;s quiz for a streak bonus</p>
                <Link href="/quiz"><button className="btn-primary w-full text-sm py-2">Take the Challenge</button></Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
