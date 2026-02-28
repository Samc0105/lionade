"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getSubjectStats, getQuizHistory, getDailyProgress } from "@/lib/db";
import {
  getLevelProgress,
  formatCoins,
  SUBJECT_ICONS,
  SUBJECT_COLORS,
  XP_PER_LEVEL,
} from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Let\u2019s build momentum.";
  if (h < 18) return "Keep the streak alive.";
  return "One more win before midnight.";
}

/* ── Infinite Scroll Carousel ── */
function InfiniteCarousel({ children }: { children: React.ReactNode[] }) {
  return (
    <div className="overflow-hidden -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="infinite-scroll-track flex gap-3" style={{ width: "max-content" }}>
        {children}
        {children}
      </div>
    </div>
  );
}

/* ── Circular stat widget ── */
function CircleStat({ value, label, icon, color, size = 90 }: {
  value: string; label: string; icon: string; color: string; size?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 group">
      <div className="relative rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
        style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}15, ${color}08)`, border: `1.5px solid ${color}25`, boxShadow: `0 0 20px ${color}08` }}>
        <div className="text-center">
          <span className="text-sm block mb-0.5">{icon}</span>
          <span className="font-bebas text-lg leading-none" style={{ color }}>{value}</span>
        </div>
        {/* Orbiting dot */}
        <div className="absolute inset-0 rounded-full" style={{ animation: "orbit-stat 8s linear infinite" }}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        </div>
      </div>
      <span className="text-cream/30 text-[9px] font-mono tracking-wider uppercase">{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const [recentQuizzes, setRecentQuizzes] = useState<
    { id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; completed_at: string }[]
  >([]);
  const [subjectStats, setSubjectStats] = useState<
    { subject: string; questionsAnswered: number; correctAnswers: number; coinsEarned: number }[]
  >([]);
  const [, setLoadingData] = useState(true);
  const [dailyProgress, setDailyProgress] = useState({ questions_answered: 0, coins_earned: 0 });
  const [xpMounted, setXpMounted] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getSubjectStats(user.id).catch(() => []),
      getQuizHistory(user.id, 5).catch(() => []),
      getDailyProgress(user.id).catch(() => ({ questions_answered: 0, coins_earned: 0 })),
    ]).then(([stats, history, daily]) => {
      console.log("[Dashboard] subjectStats:", stats);
      console.log("[Dashboard] recentQuizzes:", history);
      console.log("[Dashboard] dailyProgress:", daily);
      setSubjectStats(stats);
      setRecentQuizzes(history);
      setDailyProgress(daily);
      setLoadingData(false);
    });
    refreshUser();
  }, [user?.id]);

  useEffect(() => {
    const t = setTimeout(() => setXpMounted(true), 200);
    return () => clearTimeout(t);
  }, []);

  if (!user) return null;

  console.log("[Dashboard] user:", { coins: user.coins, xp: user.xp, streak: user.streak, level: user.level });
  const { level, progress, xpToNext } = getLevelProgress(user.xp);
  const currentXp = user.xp % XP_PER_LEVEL;
  const todayCoins = dailyProgress.coins_earned;
  const displaySubjects = subjectStats;
  const dailyDone = dailyProgress.questions_answered > 0;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const cardShapes = [
    "rounded-[24px]",
    "rounded-tl-[32px] rounded-br-[32px] rounded-tr-[8px] rounded-bl-[8px]",
    "rounded-[24px]",
    "rounded-tr-[32px] rounded-bl-[32px] rounded-tl-[8px] rounded-br-[8px]",
    "rounded-[24px]",
  ];

  return (
    <ProtectedRoute>
      <style jsx global>{`
        @keyframes orbit-stat {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.5s ease both;
        }
        @keyframes infiniteScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .infinite-scroll-track {
          animation: infiniteScroll 25s linear infinite;
        }
        .infinite-scroll-track:hover {
          animation-play-state: paused;
        }
      `}</style>

      <div className="min-h-screen pt-16 pb-20 md:pb-8 relative overflow-hidden">
        {/* Background floating shapes */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          <div className="geo-float absolute" style={{ top: "10%", right: "5%", animationDuration: "16s" }}>
            <div style={{ width: 20, height: 20, border: "1px solid rgba(74,144,217,0.08)", transform: "rotate(45deg)" }} />
          </div>
          <div className="geo-spin absolute" style={{ bottom: "20%", left: "3%", animationDuration: "22s" }}>
            <div style={{ width: 30, height: 30, border: "1px solid rgba(255,215,0,0.06)", borderRadius: "50%" }} />
          </div>
          <div className="geo-float absolute" style={{ top: "50%", right: "8%", animationDelay: "-5s", animationDuration: "14s" }}>
            <svg width="18" height="16" viewBox="0 0 18 16"><polygon points="9,0 18,16 0,16" fill="none" stroke="rgba(74,144,217,0.06)" strokeWidth="1" /></svg>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 relative z-10">
          <BackButton />

          {/* ═══ 1) Hero Header ═══ */}
          <div className="mb-6 animate-slide-up">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-tight">
                  Welcome back, <span className="text-electric">{user.username}</span>
                </h1>
                <p className="text-cream/40 text-sm mt-1">{getGreeting()}</p>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
                <p className="text-cream/25 text-xs">{today}</p>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full bg-electric/10 text-electric/80 border border-electric/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-electric animate-pulse" />
                  Ready to study
                </span>
              </div>
            </div>
          </div>

          {/* ═══ 2) Circular Stats Row ═══ */}
          <div className="flex justify-center sm:justify-start gap-6 sm:gap-8 mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            <CircleStat icon="&#x1FA99;" value={formatCoins(user.coins)} label={`+${todayCoins} today`} color="#FFD700" />
            <CircleStat icon="&#x1F525;" value={String(user.streak)} label="day streak" color="#E67E22" />
            <CircleStat icon="&#x26A1;" value={`Lv${level}`} label={`${xpToNext} xp left`} color="#4A90D9" />
            <CircleStat icon="&#x1F4DA;" value={String(displaySubjects.length)} label="subjects" color="#9B59B6" />
          </div>

          {/* ═══ 3) XP Progress ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.08s" }}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-cream/50 text-xs font-semibold">Level {level}</span>
                <span className="text-cream/20 text-[10px]">{currentXp.toLocaleString()} / {XP_PER_LEVEL.toLocaleString()} XP</span>
              </div>
              <span className="text-cream/25 text-[10px]">{progress.toFixed(0)}% &bull; {xpToNext} XP to Level {level + 1}</span>
            </div>
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: xpMounted ? `${Math.max(progress, 2)}%` : "0%", background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 10px #4A90D950" }} />
            </div>
          </div>

          {/* ═══ 4) Mission Hero ═══ */}
          <div className="rounded-tl-[32px] rounded-br-[32px] rounded-tr-[12px] rounded-bl-[12px] p-6 sm:p-8 mb-8 animate-slide-up relative overflow-hidden transition-all duration-300 hover:scale-[1.01]"
            style={{ background: "linear-gradient(135deg, #0d1528 0%, #0a1020 50%, #0d1528 100%)", boxShadow: "0 0 0 1px rgba(74,144,217,0.1), 0 8px 32px rgba(0,0,0,0.3)", animationDelay: "0.1s" }}>
            {/* Decorative orb */}
            <div className="absolute top-0 right-0 w-56 h-56 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(255,215,0,0.04), transparent 70%)" }} />
            {/* Accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #FFD700, #4A90D9, transparent)" }} />

            <div className="relative flex items-start gap-5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gold/10 flex items-center justify-center flex-shrink-0"
                style={{ boxShadow: "0 0 24px rgba(255,215,0,0.06)" }}>
                <span className="text-3xl sm:text-4xl">&#x1F3AF;</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bebas text-2xl sm:text-3xl text-cream tracking-wider">TODAY&apos;S MISSION</p>
                <p className="text-cream/70 text-sm sm:text-base mt-0.5">Complete Daily Quiz</p>
                <p className="text-cream/30 text-xs mt-1">Earn +10 coins &bull; Protect your streak</p>
                {/* Daily progress bar */}
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-cream/50 text-[11px] font-semibold">Questions today</span>
                    <span className="text-cream/40 text-[11px] font-mono">{dailyProgress.questions_answered}/10</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full transition-all duration-1000 ease-out daily-progress-bar"
                      style={{ width: xpMounted ? `${Math.min((dailyProgress.questions_answered / 10) * 100, 100)}%` : "0%", background: "linear-gradient(90deg, #FFD700, #FFA500)", boxShadow: dailyProgress.questions_answered > 0 ? "0 0 8px rgba(255,215,0,0.4)" : "none" }} />
                  </div>
                  {dailyProgress.questions_answered >= 10 && (
                    <p className="text-gold text-[10px] font-semibold mt-1">&#x2728; Daily goal complete!</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 mt-4">
                  <Link href="/quiz">
                    <button className="gold-btn px-6 py-2.5 rounded-full font-syne font-bold text-sm text-navy">
                      {dailyDone ? "Practice a Subject" : "Start Daily Quiz"}
                    </button>
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-cream/25 text-xs font-semibold">{dailyProgress.questions_answered >= 10 ? "10" : dailyProgress.questions_answered}/10</span>
                    <span className="text-cream/15 text-[10px]">&bull; +{dailyProgress.coins_earned} coins earned</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ 5) Continue — Infinite Rotating Carousel ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.15s" }}>
            <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">CONTINUE</h2>
            <InfiniteCarousel>
              {[
                ...(!dailyDone ? [{
                  subject: "Daily Quiz", icon: "\uD83E\uDDE0", color: "#4A90D9",
                  accuracy: null as number | null,
                }] : []),
                ...displaySubjects.slice(0, 5).map((stat) => ({
                  subject: stat.subject,
                  icon: SUBJECT_ICONS[stat.subject as keyof typeof SUBJECT_ICONS] ?? "\u{1F4DA}",
                  color: SUBJECT_COLORS[stat.subject as keyof typeof SUBJECT_COLORS] ?? "#4A90D9",
                  accuracy: stat.questionsAnswered > 0 ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100) : 0,
                })),
              ].map((item, i) => (
                <div key={`${item.subject}-${i}`} className={`flex-shrink-0 w-36 p-3.5 select-none ${
                  i % 3 === 0 ? "rounded-[20px]" : i % 3 === 1 ? "rounded-tl-[28px] rounded-br-[28px] rounded-tr-[6px] rounded-bl-[6px]" : "rounded-full"
                }`} style={{ background: `linear-gradient(135deg, ${item.color}12 0%, ${item.color}06 100%)`, border: `1px solid ${item.color}18` }}>
                  <span className="text-2xl block">{item.icon}</span>
                  <p className="font-semibold text-cream text-xs mt-2">{item.subject}</p>
                  {item.accuracy !== null ? (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${item.accuracy}%`, background: item.color }} />
                      </div>
                      <span className="text-cream/35 text-[9px]">{item.accuracy}%</span>
                    </div>
                  ) : (
                    <p className="text-cream/25 text-[10px] mt-0.5">10 questions</p>
                  )}
                </div>
              ))}
            </InfiniteCarousel>
          </div>

          {/* ═══ 6) Two-Column Lower ═══ */}
          <div className="grid lg:grid-cols-3 gap-6">

            {/* Left: Subjects as cards */}
            <div className="lg:col-span-2 animate-slide-up" style={{ animationDelay: "0.2s" }}>
              <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">YOUR SUBJECTS</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {displaySubjects.slice(0, 6).map((stat, i) => {
                  const accuracy = stat.questionsAnswered > 0 ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100) : 0;
                  const icon = SUBJECT_ICONS[stat.subject as keyof typeof SUBJECT_ICONS] ?? "\u{1F4DA}";
                  const color = SUBJECT_COLORS[stat.subject as keyof typeof SUBJECT_COLORS] ?? "#4A90D9";
                  return (
                    <Link key={stat.subject} href="/learn">
                      <div className={`tilt-card group p-4 transition-all duration-300 hover:scale-[1.02] ${cardShapes[i % cardShapes.length]}`}
                        style={{ background: `linear-gradient(135deg, ${color}08 0%, #080E1A 100%)`, border: `1px solid ${color}15` }}>
                        {/* Top accent */}
                        <div className="absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
                            <span className="text-lg">{icon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-cream text-sm">{stat.subject}</span>
                              <span className="text-xs font-mono" style={{ color }}>{accuracy}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${accuracy}%`, background: `linear-gradient(90deg, ${color}80, ${color})` }} />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-3">
                          <span className="text-cream/25 text-[10px]">{stat.questionsAnswered} answered</span>
                          <span className="text-cream/25 text-[10px]">{formatCoins(stat.coinsEarned)} coins</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right sidebar */}
            <div className="space-y-5">

              {/* This Week */}
              <div className="animate-slide-up" style={{ animationDelay: "0.18s" }}>
                <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">THIS WEEK</h2>
                <div className="rounded-[20px] p-4 space-y-2.5"
                  style={{ background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)", border: "1px solid rgba(74,144,217,0.08)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-cream/40 text-xs">Your rank</span>
                    <span className="text-cream/20 text-xs font-semibold">&mdash; (soon)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-cream/40 text-xs">Top player</span>
                    <span className="text-cream/20 text-xs font-semibold">&mdash; (soon)</span>
                  </div>
                  <p className="text-cream/15 text-[10px] pt-1">Win duels to climb the leaderboard.</p>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="animate-slide-up" style={{ animationDelay: "0.22s" }}>
                <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">RECENT ACTIVITY</h2>
                {recentQuizzes.length > 0 ? (
                  <div className="space-y-1">
                    {recentQuizzes.map((quiz, i) => (
                      <div key={quiz.id} className={`flex items-center gap-3 py-2.5 px-3 transition-all duration-200 hover:bg-white/[0.03] ${
                        i % 2 === 0 ? "rounded-[16px]" : "rounded-tl-[20px] rounded-br-[20px] rounded-tr-[6px] rounded-bl-[6px]"
                      }`}>
                        <span className="text-lg flex-shrink-0">{SUBJECT_ICONS[quiz.subject as keyof typeof SUBJECT_ICONS] ?? "\u{1F4DA}"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-xs font-semibold truncate">{quiz.subject}</p>
                          <p className="text-cream/25 text-[10px]">{timeAgo(quiz.completed_at)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-mono text-cream/60">{quiz.correct_answers}/{quiz.total_questions}</span>
                          <span className="text-xs font-bold text-gold">+{quiz.coins_earned}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[20px] p-6 text-center"
                    style={{ background: "linear-gradient(135deg, rgba(13,21,40,0.5) 0%, rgba(10,16,32,0.5) 100%)", border: "1px solid rgba(74,144,217,0.06)" }}>
                    <span className="text-3xl block mb-2">&#x1FA99;</span>
                    <p className="font-bebas text-base text-cream/50 tracking-wider">No activity yet</p>
                    <p className="text-cream/25 text-xs mt-1 mb-4 leading-relaxed">Take your first quiz to start tracking progress.</p>
                    <Link href="/quiz">
                      <button className="font-syne font-semibold text-xs px-4 py-2 rounded-full transition-all duration-200 active:scale-95 border border-electric/30 text-electric hover:bg-electric/10">
                        Start Quiz
                      </button>
                    </Link>
                  </div>
                )}
              </div>

              {/* Ninny's Notes */}
              <div className="animate-slide-up" style={{ animationDelay: "0.26s" }}>
                <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">NINNY&apos;S NOTES</h2>
                <div className="rounded-tl-[24px] rounded-br-[24px] rounded-tr-[8px] rounded-bl-[8px] p-4 idle-glow-ninny"
                  style={{ background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)", border: "1px solid rgba(74,144,217,0.08)" }}>
                  <div className="space-y-2.5 mb-4">
                    <div className="flex items-start gap-2">
                      <span className="text-electric text-[10px] mt-0.5 flex-shrink-0">&#x25CF;</span>
                      <p className="text-cream/50 text-xs leading-relaxed">You perform better in the morning. Try studying before noon.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-electric text-[10px] mt-0.5 flex-shrink-0">&#x25CF;</span>
                      <p className="text-cream/50 text-xs leading-relaxed">Science accuracy up 12% this week. Keep it up.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <button disabled className="text-[11px] font-semibold py-1.5 px-3 rounded-full border border-electric/15 text-cream/25 bg-white/[0.03] cursor-not-allowed">
                      Review Weak Spot (Soon)
                    </button>
                    <button disabled className="text-[11px] font-semibold py-1.5 px-3 rounded-full border border-electric/15 text-cream/25 bg-white/[0.03] cursor-not-allowed">
                      Ask Ninny (Soon)
                    </button>
                  </div>
                  <p className="text-cream/15 text-[10px] italic">Ninny is analyzing your progress&hellip;</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
