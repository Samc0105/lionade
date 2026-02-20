"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getLeaderboard, getRecentActivity, getSubjectStats } from "@/lib/db";
import { getLevelProgress, formatCoins, SUBJECT_ICONS } from "@/lib/mockData";
import StreakCounter from "@/components/StreakCounter";
import LeaderboardRow from "@/components/LeaderboardRow";
import ProtectedRoute from "@/components/ProtectedRoute";
import type { LeaderboardEntry } from "@/types";

const QUICK_ACTIONS = [
  { href: "/quiz", icon: "🧠", label: "Daily Quiz", desc: "New questions await" },
  { href: "/duel", icon: "⚔️", label: "Find a Duel", desc: "Challenge someone now" },
  { href: "/leaderboard", icon: "🏆", label: "Leaderboard", desc: "Check your rank" },
  { href: "/profile", icon: "🎖️", label: "Badges", desc: "View your collection" },
];

function ActivityIcon(type: string) {
  const map: Record<string, string> = {
    quiz_reward: "✅", duel_win: "⚔️", duel_loss: "💀",
    streak_bonus: "🔥", badge_bonus: "🎖️", signup_bonus: "🎉",
  };
  return map[type] ?? "🪙";
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
      // Map leaderboard to LeaderboardEntry shape
      setLeaderboard(lb.map((e, i) => ({
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
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-slide-up">
            <div>
              <p className="text-cream/40 text-sm font-semibold uppercase tracking-widest mb-1">{today}</p>
              <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider">
                Welcome back, <span className="text-electric">{user.username}</span> 👋
              </h1>
            </div>
            <Link href="/quiz">
              <button className="btn-gold px-6 py-3 text-base rounded-xl whitespace-nowrap">
                🧠 Start Today&apos;s Quiz
              </button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="stat-box animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <span className="text-3xl">🪙</span>
              <p className="font-bebas text-4xl text-gold glow-gold leading-none mt-1">{formatCoins(user.coins)}</p>
              <p className="text-cream/40 text-xs font-semibold uppercase tracking-widest">Total Coins</p>
            </div>
            <div className="stat-box animate-slide-up" style={{ animationDelay: "0.15s" }}>
              <StreakCounter streak={user.streak} size="md" showLabel />
            </div>
            <div className="stat-box animate-slide-up" style={{ animationDelay: "0.2s" }}>
              <span className="text-3xl">⚡</span>
              <p className="font-bebas text-4xl text-electric leading-none mt-1">LVL {level}</p>
              <p className="text-cream/40 text-xs font-semibold uppercase tracking-widest">Current Level</p>
            </div>
            <div className="stat-box animate-slide-up" style={{ animationDelay: "0.25s" }}>
              <span className="text-3xl">📊</span>
              <p className="font-bebas text-4xl text-cream leading-none mt-1">{subjectStats.length}</p>
              <p className="text-cream/40 text-xs font-semibold uppercase tracking-widest">Subjects Done</p>
            </div>
          </div>

          {/* XP Bar */}
          <div className="card mb-8 animate-slide-up" style={{ animationDelay: "0.3s" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-electric/20 border border-electric/40 flex items-center justify-center">
                  <span className="font-bebas text-lg text-electric">{level}</span>
                </div>
                <div>
                  <p className="font-bold text-cream text-sm">Level {level}</p>
                  <p className="text-cream/40 text-xs">{user.xp.toLocaleString()} XP total</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bebas text-xl text-electric">{xpToNext} XP</p>
                <p className="text-cream/40 text-xs">to Level {level + 1}</p>
              </div>
            </div>
            <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${progress}%`, background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 12px #4A90D980" }} />
            </div>
            <p className="text-cream/30 text-xs mt-2 text-right">{progress.toFixed(0)}% to next level</p>
          </div>

          {/* Grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              {/* Quick Actions */}
              <div>
                <h2 className="font-bebas text-2xl text-cream tracking-wider mb-4">QUICK ACTIONS</h2>
                <div className="grid grid-cols-2 gap-3">
                  {QUICK_ACTIONS.map((action) => (
                    <Link key={action.href} href={action.href}>
                      <div className="card-hover p-5 rounded-xl group cursor-pointer">
                        <span className="text-3xl group-hover:scale-110 transition-transform duration-300 inline-block mb-3">{action.icon}</span>
                        <p className="font-bebas text-xl text-cream tracking-wider">{action.label}</p>
                        <p className="text-cream/40 text-xs mt-0.5">{action.desc}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Subject Stats */}
              {subjectStats.length > 0 && (
                <div>
                  <h2 className="font-bebas text-2xl text-cream tracking-wider mb-4">SUBJECT MASTERY</h2>
                  <div className="card space-y-4">
                    {subjectStats.map((stat) => {
                      const accuracy = stat.questionsAnswered > 0
                        ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100)
                        : 0;
                      return (
                        <div key={stat.subject}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{SUBJECT_ICONS[stat.subject as keyof typeof SUBJECT_ICONS] ?? "📚"}</span>
                              <span className="font-semibold text-cream text-sm">{stat.subject}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-cream/50">
                              <span>{accuracy}% accuracy</span>
                              <span className="text-gold">🪙 {formatCoins(stat.coinsEarned)}</span>
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
                  <p className="text-4xl mb-3">🧠</p>
                  <p className="font-bebas text-2xl text-cream tracking-wider mb-2">No quizzes yet</p>
                  <p className="text-cream/40 text-sm mb-4">Take your first quiz to start tracking mastery</p>
                  <Link href="/quiz"><button className="btn-gold px-6 py-2.5 text-sm">Start a Quiz</button></Link>
                </div>
              )}
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* Leaderboard */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bebas text-2xl text-cream tracking-wider">TOP EARNERS</h2>
                  <Link href="/leaderboard" className="text-electric text-sm font-semibold hover:text-electric-light">Full board →</Link>
                </div>
                {loadingData ? (
                  <div className="space-y-2">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />
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
                <h2 className="font-bebas text-2xl text-cream tracking-wider mb-4">RECENT ACTIVITY</h2>
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
                <div className="text-4xl mb-3 animate-float">🎯</div>
                <p className="font-bebas text-xl text-gold tracking-wider mb-1">DAILY CHALLENGE</p>
                <p className="text-cream/60 text-xs mb-4">Score 100% on today&apos;s quiz for a streak bonus</p>
                <Link href="/quiz"><button className="btn-gold w-full text-sm py-2.5">Take the Challenge</button></Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
