"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getAllBadges, getUserBadges, getSubjectStats, getQuizHistory } from "@/lib/db";
import { getLevelProgress, formatCoins, SUBJECT_ICONS, SUBJECT_COLORS } from "@/lib/mockData";
import BadgeCard from "@/components/BadgeCard";
import StreakCounter from "@/components/StreakCounter";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

type Tab = "overview" | "badges" | "stats" | "history";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [allBadges, setAllBadges] = useState<{ id: string; name: string; description: string | null; icon: string; rarity: string }[]>([]);
  const [earnedBadges, setEarnedBadges] = useState<{ id: string; name: string; description: string | null; icon: string; rarity: string; earnedAt: string }[]>([]);
  const [subjectStats, setSubjectStats] = useState<{ subject: string; questionsAnswered: number; correctAnswers: number; coinsEarned: number }[]>([]);
  const [quizHistory, setQuizHistory] = useState<{ id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; completed_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    refreshUser();
    Promise.all([
      getAllBadges().catch(() => []),
      getUserBadges(user.id).catch(() => []),
      getSubjectStats(user.id).catch(() => []),
      getQuizHistory(user.id, 15).catch(() => []),
    ]).then(([all, earned, stats, history]) => {
      setAllBadges(all);
      setEarnedBadges(earned);
      setSubjectStats(stats);
      setQuizHistory(history);
      setLoading(false);
    });
  }, [user?.id]);

  if (!user) return null;

  const { level, progress, xpToNext } = getLevelProgress(user.xp);

  const totalQuestions = subjectStats.reduce((s, r) => s + r.questionsAnswered, 0);
  const totalCorrect = subjectStats.reduce((s, r) => s + r.correctAnswers, 0);
  const overallAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  const lockedBadges = allBadges.filter(b => !earnedBadges.some(e => e.id === b.id));

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "overview", label: "Overview", icon: "📊" },
    { key: "badges",   label: "Badges",   icon: "🎖️" },
    { key: "stats",    label: "Stats",    icon: "📈" },
    { key: "history",  label: "History",  icon: "📅" },
  ];

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-20">
        <div className="max-w-5xl mx-auto px-4 py-8">

          {/* Profile Hero */}
          <div className="relative rounded-2xl overflow-hidden mb-6 animate-slide-up p-6 sm:p-8"
            style={{ background: "linear-gradient(135deg, #0a1428 0%, #060c18 60%, #0d1535 100%)", border: "1px solid #4A90D930" }}>
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none"
              style={{ background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)" }} />

            <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-4"
                  style={{ borderColor: "#4A90D9", boxShadow: "0 0 25px #4A90D960" }}>
                  <img src={user.avatar} alt={user.username} className="w-full h-full object-cover bg-navy-50" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center font-bebas text-sm"
                  style={{ background: "#4A90D9" }}>{level}</div>
              </div>

              {/* Info */}
              <div className="flex-1 text-center sm:text-left">
                <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider mb-1">{user.username}</h1>
                <p className="text-cream/40 text-sm mb-4">{user.displayName} · Joined Lionade</p>

                <div className="flex flex-wrap justify-center sm:justify-start gap-4 mb-5">
                  {[
                    { value: formatCoins(user.coins), label: "Total Coins", color: "text-gold" },
                    { value: `🔥 ${user.streak}`, label: "Day Streak", color: "text-orange-400" },
                    { value: `${overallAccuracy}%`, label: "Accuracy", color: "text-electric" },
                    { value: `${earnedBadges.length}`, label: "Badges", color: "text-cream" },
                  ].map((s) => (
                    <div key={s.label} className="text-center sm:text-left">
                      <p className={`font-bebas text-2xl leading-none ${s.color}`}>{s.value}</p>
                      <p className="text-cream/40 text-xs">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* XP Bar */}
                <div>
                  <div className="flex justify-between text-xs text-cream/40 mb-1.5">
                    <span>Level {level}</span>
                    <span>{xpToNext} XP to Level {level + 1}</span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 10px #4A90D960" }} />
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0">
                <StreakCounter streak={user.streak} size="lg" showLabel />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-navy-50 border border-electric/20 rounded-xl p-1 mb-8">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200
                  ${activeTab === tab.key ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream hover:bg-white/5"}`}>
                <span>{tab.icon}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Overview */}
          {activeTab === "overview" && (
            <div className="grid sm:grid-cols-2 gap-6 animate-slide-up">
              <div className="card">
                <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">TOP SUBJECTS</h3>
                {subjectStats.length === 0 ? (
                  <p className="text-cream/40 text-sm text-center py-4">No quiz data yet. Take a quiz!</p>
                ) : (
                  <div className="space-y-3">
                    {[...subjectStats].sort((a, b) => (b.correctAnswers / (b.questionsAnswered || 1)) - (a.correctAnswers / (a.questionsAnswered || 1))).slice(0, 4).map((stat) => {
                      const acc = stat.questionsAnswered > 0 ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100) : 0;
                      const color = SUBJECT_COLORS[stat.subject as keyof typeof SUBJECT_COLORS] ?? "#4A90D9";
                      return (
                        <div key={stat.subject}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="flex items-center gap-2">
                              <span>{SUBJECT_ICONS[stat.subject as keyof typeof SUBJECT_ICONS] ?? "📚"}</span>
                              <span className="text-cream font-semibold">{stat.subject}</span>
                            </span>
                            <span className="text-cream/50">{acc}%</span>
                          </div>
                          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${acc}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bebas text-xl text-cream tracking-wider">RECENT BADGES</h3>
                  <button onClick={() => setActiveTab("badges")} className="text-electric text-xs font-semibold">View all →</button>
                </div>
                {earnedBadges.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-3xl mb-2">🔒</p>
                    <p className="text-cream/40 text-sm">Complete quizzes to earn badges</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {earnedBadges.slice(0, 6).map((badge) => (
                      <BadgeCard key={badge.id} badge={{ ...badge, description: badge.description ?? "", rarity: badge.rarity as "common" | "rare" | "epic" | "legendary", earnedAt: badge.earnedAt }} size="sm" earned />
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">RECORDS</h3>
                <div className="space-y-3">
                  {[
                    { label: "Total Questions", value: totalQuestions.toLocaleString(), icon: "❓" },
                    { label: "Correct Answers", value: totalCorrect.toLocaleString(), icon: "✅" },
                    { label: "Quizzes Completed", value: quizHistory.length.toString(), icon: "📝" },
                    { label: "Current Streak", value: `${user.streak} days`, icon: "🔥" },
                    { label: "Total XP", value: user.xp.toLocaleString(), icon: "⚡" },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between items-center py-2 border-b border-electric/10 last:border-0">
                      <span className="flex items-center gap-2 text-cream/60 text-sm"><span>{r.icon}</span>{r.label}</span>
                      <span className="font-bold text-cream text-sm">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">QUICK ACTIONS</h3>
                <div className="space-y-3">
                  <Link href="/quiz"><button className="btn-primary w-full py-3 text-sm">🧠 Take Daily Quiz</button></Link>
                  <Link href="/duel"><button className="btn-outline w-full py-3 text-sm">⚔️ Challenge Someone</button></Link>
                </div>
              </div>
            </div>
          )}

          {/* Badges */}
          {activeTab === "badges" && (
            <div className="animate-slide-up">
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[1,2,3,4].map(i => <div key={i} className="h-36 rounded-xl bg-white/5 animate-pulse" />)}
                </div>
              ) : (
                <>
                  <h3 className="font-bebas text-2xl text-cream tracking-wider mb-4">EARNED · {earnedBadges.length}</h3>
                  {earnedBadges.length === 0 ? (
                    <div className="card text-center py-10 mb-8">
                      <p className="text-4xl mb-3">🏅</p>
                      <p className="text-cream/40">No badges yet — start quizzing to unlock them!</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-8">
                      {earnedBadges.map((badge) => (
                        <BadgeCard key={badge.id} badge={{ ...badge, description: badge.description ?? "", rarity: badge.rarity as "common" | "rare" | "epic" | "legendary", earnedAt: badge.earnedAt }} size="md" earned />
                      ))}
                    </div>
                  )}
                  <h3 className="font-bebas text-2xl text-cream tracking-wider mb-4">LOCKED · {lockedBadges.length}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {lockedBadges.map((badge) => (
                      <BadgeCard key={badge.id} badge={{ ...badge, description: badge.description ?? "", rarity: badge.rarity as "common" | "rare" | "epic" | "legendary" }} size="md" earned={false} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Stats */}
          {activeTab === "stats" && (
            <div className="animate-slide-up space-y-6">
              <div className="card">
                <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">OVERALL</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Total Questions", value: totalQuestions, icon: "📝" },
                    { label: "Correct Answers", value: totalCorrect, icon: "✅" },
                    { label: "Overall Accuracy", value: `${overallAccuracy}%`, icon: "🎯" },
                    { label: "Total Coins", value: formatCoins(user.coins), icon: "🪙" },
                  ].map((s) => (
                    <div key={s.label} className="text-center p-4 rounded-xl bg-white/3 border border-electric/10">
                      <span className="text-2xl block mb-2">{s.icon}</span>
                      <p className="font-bebas text-2xl text-electric leading-none">{s.value}</p>
                      <p className="text-cream/40 text-xs mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">BY SUBJECT</h3>
                {subjectStats.length === 0 ? (
                  <p className="text-cream/40 text-center py-4">Take quizzes to see subject stats</p>
                ) : (
                  <div className="space-y-4">
                    {subjectStats.map((stat) => {
                      const acc = stat.questionsAnswered > 0 ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100) : 0;
                      const color = SUBJECT_COLORS[stat.subject as keyof typeof SUBJECT_COLORS] ?? "#4A90D9";
                      return (
                        <div key={stat.subject} className="p-4 rounded-xl border border-electric/10">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{SUBJECT_ICONS[stat.subject as keyof typeof SUBJECT_ICONS] ?? "📚"}</span>
                              <span className="font-bebas text-xl text-cream tracking-wider">{stat.subject}</span>
                            </div>
                            <span className="font-bold text-sm" style={{ color }}>{acc}%</span>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-center text-xs mb-3">
                            <div><p className="font-bold text-cream">{stat.questionsAnswered}</p><p className="text-cream/40">Attempted</p></div>
                            <div><p className="font-bold text-green-400">{stat.correctAnswers}</p><p className="text-cream/40">Correct</p></div>
                            <div><p className="font-bold text-gold">🪙 {formatCoins(stat.coinsEarned)}</p><p className="text-cream/40">Earned</p></div>
                          </div>
                          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${acc}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* History */}
          {activeTab === "history" && (
            <div className="animate-slide-up">
              <h3 className="font-bebas text-2xl text-cream tracking-wider mb-4">QUIZ HISTORY</h3>
              {quizHistory.length === 0 ? (
                <div className="card text-center py-10">
                  <p className="text-4xl mb-3">📅</p>
                  <p className="text-cream/40">No quiz history yet. Take your first quiz!</p>
                  <Link href="/quiz"><button className="btn-gold px-6 py-2.5 text-sm mt-4">Start a Quiz</button></Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {quizHistory.map((h) => {
                    const acc = Math.round((h.correct_answers / h.total_questions) * 100);
                    const isPerfect = acc === 100;
                    const isGood = acc >= 70;
                    return (
                      <div key={h.id} className="flex items-center gap-4 p-4 rounded-xl border border-electric/10 hover:border-electric/30 transition-all"
                        style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 border
                          ${isPerfect ? "bg-gold/20 border-gold/50" : isGood ? "bg-green-400/20 border-green-400/50" : "bg-red-400/20 border-red-400/50"}`}>
                          {isPerfect ? "💎" : isGood ? "✅" : "❌"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-cream text-sm">{h.subject}</p>
                          <p className="text-cream/40 text-xs">{new Date(h.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                        </div>
                        <div className="text-center flex-shrink-0">
                          <p className="font-bold text-cream text-sm">{h.correct_answers}/{h.total_questions}</p>
                          <p className="text-cream/30 text-xs">{acc}%</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`font-bebas text-lg ${h.coins_earned > 0 ? "text-gold" : "text-cream/30"}`}>
                            {h.coins_earned > 0 ? `+${h.coins_earned}` : "—"}
                          </p>
                          <p className="text-cream/30 text-xs">coins</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
