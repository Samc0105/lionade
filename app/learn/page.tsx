"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { getQuizHistory, getLeaderboard } from "@/lib/db";
import { LEADERBOARD_ENTRIES, SUBJECT_ICONS, SUBJECT_COLORS, formatCoins } from "@/lib/mockData";
import type { Subject } from "@/types";

/* ── Ninny Modal ────────────────────────────────────────────── */

function NinnyModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl border border-electric/20 max-w-md w-full p-8 text-center animate-slide-up"
        style={{
          background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon circle */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{
            background:
              "radial-gradient(circle at 40% 35%, #E67E2225 0%, #E67E220A 70%, transparent 100%)",
            boxShadow: "0 0 30px #E67E2218, 0 0 0 1px #E67E2220",
          }}
        >
          <span className="text-4xl">&#x1F916;</span>
        </div>

        <p className="font-bebas text-2xl text-cream tracking-wider mb-1">
          Study With Ninny{" "}
          <span className="text-cream/40">(Coming Soon)</span>
        </p>
        <p className="text-cream/50 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
          Upload anything or tell Ninny what you&apos;re studying. Ninny will
          summarize, generate flashcards, and create practice questions.
        </p>

        <div className="flex flex-col sm:flex-row gap-2.5 justify-center mb-6">
          <button
            disabled
            className="font-syne font-semibold text-sm px-5 py-2.5 rounded-xl border border-cream/10
              text-cream/25 bg-white/5 cursor-not-allowed"
          >
            Upload Material (Soon)
          </button>
          <button
            disabled
            className="font-syne font-semibold text-sm px-5 py-2.5 rounded-xl border border-cream/10
              text-cream/25 bg-white/5 cursor-not-allowed"
          >
            Tell Ninny What to Study (Soon)
          </button>
        </div>

        <button
          onClick={onClose}
          className="font-syne font-bold text-sm px-6 py-2.5 rounded-lg transition-all duration-200
            active:scale-95 text-navy bg-electric hover:bg-electric-light"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ── Coming Soon Modal (Practice Sets) ────────────────────── */

function ComingSoonModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl border border-electric/20 max-w-sm w-full p-8 text-center animate-slide-up"
        style={{
          background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{
            background:
              "radial-gradient(circle at 40% 35%, #2ECC7125 0%, #2ECC710A 70%, transparent 100%)",
            boxShadow: "0 0 30px #2ECC7118, 0 0 0 1px #2ECC7120",
          }}
        >
          <span className="text-3xl">&#x1F4DD;</span>
        </div>
        <p className="font-bebas text-2xl text-cream tracking-wider mb-1">
          Practice Sets
        </p>
        <span
          className="inline-block text-[10px] font-bold uppercase tracking-widest
          px-2.5 py-0.5 rounded-full border border-[#2ECC71]/30 text-[#2ECC71]/70 bg-[#2ECC71]/10 mb-3"
        >
          Coming Soon
        </span>
        <p className="text-cream/50 text-sm leading-relaxed mb-5">
          Curated question sets grouped by difficulty. Perfect for focused study
          sessions.
        </p>
        <button
          onClick={onClose}
          className="font-syne font-bold text-sm px-6 py-2.5 rounded-lg transition-all duration-200
            active:scale-95 text-navy bg-electric hover:bg-electric-light"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ── Motivational Quotes ──────────────────────────────────── */

const QUOTES = [
  "The grind doesn\u2019t stop. Neither do you.",
  "Every correct answer is money in the bank.",
  "Your streak is your reputation. Protect it.",
  "Champions study when nobody\u2019s watching.",
];

function getDailyQuote(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return QUOTES[dayOfYear % QUOTES.length];
}

/* ── Card Grid Config ─────────────────────────────────────── */

const CARDS = [
  {
    id: "quiz",
    icon: "\u{1F9E0}",
    title: "Daily Quiz",
    subtitle: "5 min \u2022 +10 coins",
    color: "#EAB308",
    action: "navigate" as const,
    href: "/quiz",
  },
  {
    id: "subjects",
    icon: "\u{1F4DA}",
    title: "Subjects",
    subtitle: "Track mastery across 7 topics",
    color: "#3B82F6",
    action: "navigate" as const,
    href: "/quiz",
  },
  {
    id: "practice",
    icon: "\u{1F4DD}",
    title: "Practice Sets",
    subtitle: "Timed focus sessions",
    color: "#22C55E",
    action: "modal-practice" as const,
  },
  {
    id: "ninny",
    icon: "\u{1F916}",
    title: "Study With Ninny",
    subtitle: "AI summaries \u2022 Flashcards",
    color: "#A855F7",
    action: "modal-ninny" as const,
    badge: "Soon",
  },
];

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

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  level: number;
  streak: number;
  coins_this_week: number;
}

/* ── Page ───────────────────────────────────────────────────── */

export default function LearnPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [showNinny, setShowNinny] = useState(false);
  const [showPractice, setShowPractice] = useState(false);
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [todayCount, setTodayCount] = useState(0);

  // Fetch data on mount
  useEffect(() => {
    if (!user) return;

    // Fetch quiz history for activity feed + daily progress
    getQuizHistory(user.id, 20)
      .then((history) => {
        setQuizHistory(history);
        // Count today's questions
        const today = new Date().toISOString().split("T")[0];
        const todayQuestions = history
          .filter((h) => h.completed_at?.startsWith(today))
          .reduce((sum, h) => sum + h.total_questions, 0);
        setTodayCount(todayQuestions);
      })
      .catch(() => {});

    // Fetch leaderboard
    getLeaderboard(3)
      .then((lb) => {
        if (lb.length > 0) {
          setLeaderboard(lb);
        } else {
          // Fallback to mock data
          setLeaderboard(
            LEADERBOARD_ENTRIES.slice(0, 3).map((e) => ({
              rank: e.rank,
              user_id: e.user.id,
              username: e.user.username,
              avatar_url: null,
              level: e.user.level,
              streak: e.streak,
              coins_this_week: e.coinsThisWeek,
            }))
          );
        }
      })
      .catch(() => {
        setLeaderboard(
          LEADERBOARD_ENTRIES.slice(0, 3).map((e) => ({
            rank: e.rank,
            user_id: e.user.id,
            username: e.user.username,
            avatar_url: null,
            level: e.user.level,
            streak: e.streak,
            coins_this_week: e.coinsThisWeek,
          }))
        );
      });
  }, [user]);

  const handleCard = (card: (typeof CARDS)[number]) => {
    if (card.action === "navigate" && "href" in card) {
      router.push(card.href);
    } else if (card.action === "modal-ninny") {
      setShowNinny(true);
    } else if (card.action === "modal-practice") {
      setShowPractice(true);
    }
  };

  const recentActivity = quizHistory.slice(0, 5);
  const dailyProgressPct = Math.min((todayCount / 10) * 100, 100);
  const rankMedals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackButton />

          {/* ── 1. Greeting + Daily Quote ── */}
          <div className="text-center mb-8 animate-slide-up">
            <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider">
              Welcome back,{" "}
              <span className="shimmer-text">
                {user?.username ?? "Grinder"}
              </span>
            </h1>
            <p className="text-cream/40 text-sm sm:text-base mt-3 font-syne italic">
              &ldquo;{getDailyQuote()}&rdquo;
            </p>
          </div>

          {/* ── 2. Stats Banner ── */}
          {user && (
            <div
              className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 mb-8 animate-slide-up"
              style={{ animationDelay: "0.05s" }}
            >
              {/* Streak */}
              <div
                className="flex items-center gap-3 px-5 py-3 rounded-2xl border"
                style={{
                  background: "linear-gradient(135deg, #F9731620 0%, #F9731608 100%)",
                  borderColor: "#F9731630",
                  boxShadow: "0 0 20px #F9731610",
                }}
              >
                <span className="text-2xl">&#x1F525;</span>
                <div>
                  <p className="font-bebas text-3xl text-[#F97316] leading-none">
                    {user.streak}
                  </p>
                  <p className="text-cream/40 text-[10px] uppercase tracking-wider">
                    Streak
                  </p>
                </div>
              </div>

              {/* XP */}
              <div
                className="flex items-center gap-3 px-5 py-3 rounded-2xl border"
                style={{
                  background: "linear-gradient(135deg, #4A90D920 0%, #4A90D908 100%)",
                  borderColor: "#4A90D930",
                  boxShadow: "0 0 20px #4A90D910",
                }}
              >
                <span className="text-2xl">&#x26A1;</span>
                <div>
                  <p className="font-bebas text-3xl text-electric leading-none">
                    {user.xp.toLocaleString()}
                  </p>
                  <p className="text-cream/40 text-[10px] uppercase tracking-wider">
                    XP
                  </p>
                </div>
              </div>

              {/* Coins */}
              <div
                className="flex items-center gap-3 px-5 py-3 rounded-2xl border"
                style={{
                  background: "linear-gradient(135deg, #FFD70020 0%, #FFD70008 100%)",
                  borderColor: "#FFD70030",
                  boxShadow: "0 0 20px #FFD70010",
                }}
              >
                <span className="text-2xl">&#x1FA99;</span>
                <div>
                  <p className="font-bebas text-3xl text-gold leading-none">
                    {user.coins.toLocaleString()}
                  </p>
                  <p className="text-cream/40 text-[10px] uppercase tracking-wider">
                    Coins
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Streak === 0 message */}
          {user && user.streak === 0 && (
            <p
              className="text-center text-[#F97316] text-sm font-syne -mt-4 mb-6 animate-slide-up"
              style={{ animationDelay: "0.08s" }}
            >
              Start your streak today!
            </p>
          )}

          {/* ── 3. Daily Progress Bar ── */}
          <div
            className="mb-10 animate-slide-up"
            style={{ animationDelay: "0.1s" }}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-cream/60 text-sm font-syne">
                Daily Progress
              </p>
              <p className="font-bebas text-lg text-cream tracking-wider">
                {todayCount}/10{" "}
                <span className="text-cream/30 text-sm">questions today</span>
              </p>
            </div>
            <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden border border-white/10">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{
                  width: `${dailyProgressPct}%`,
                  background: "linear-gradient(90deg, #4A90D9, #FFD700)",
                }}
              />
            </div>
          </div>

          {/* ── 4. 2x2 Card Grid ── */}
          <div className="grid grid-cols-2 gap-4 sm:gap-5 mb-10">
            {CARDS.map((card, i) => (
              <button
                key={card.id}
                onClick={() => handleCard(card)}
                className="group relative p-5 sm:p-6 rounded-2xl border text-left transition-all duration-300
                  hover:-translate-y-1 cursor-pointer animate-slide-up"
                style={{
                  animationDelay: `${0.12 + i * 0.05}s`,
                  background: `linear-gradient(135deg, ${card.color}12 0%, #060c18 100%)`,
                  borderColor: `${card.color}30`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 30px ${card.color}25, 0 8px 32px ${card.color}15`;
                  e.currentTarget.style.borderColor = `${card.color}60`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor = `${card.color}30`;
                }}
              >
                {card.badge && (
                  <span
                    className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-widest
                      px-2 py-0.5 rounded-full"
                    style={{
                      background: `${card.color}20`,
                      border: `1px solid ${card.color}40`,
                      color: card.color,
                    }}
                  >
                    {card.badge}
                  </span>
                )}
                <span className="text-4xl sm:text-5xl block mb-3 group-hover:scale-110 transition-transform duration-300">
                  {card.icon}
                </span>
                <p
                  className="font-bebas text-xl sm:text-2xl tracking-wider"
                  style={{ color: card.color }}
                >
                  {card.title}
                </p>
                <p className="text-cream/30 text-xs sm:text-sm mt-1 font-syne">
                  {card.subtitle}
                </p>
              </button>
            ))}
          </div>

          {/* ── 5 & 6. Recent Activity + Leaderboard (side by side) ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">

            {/* Recent Activity */}
            <div
              className="rounded-2xl border border-white/10 p-5 animate-slide-up"
              style={{
                animationDelay: "0.35s",
                background: "linear-gradient(135deg, #0d1528 0%, #060c18 100%)",
              }}
            >
              <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">
                RECENT ACTIVITY
              </h2>
              {recentActivity.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-cream/40 text-sm mb-3 font-syne">
                    No activity yet — start your first quiz!
                  </p>
                  <button
                    onClick={() => router.push("/quiz")}
                    className="btn-primary text-sm px-5 py-2"
                  >
                    Start Quiz
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentActivity.map((entry) => {
                    const subj = entry.subject as Subject;
                    const icon = SUBJECT_ICONS[subj] ?? "\u{1F4DA}";
                    const color = SUBJECT_COLORS[subj] ?? "#4A90D9";
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-2.5 rounded-xl transition-colors hover:bg-white/5"
                      >
                        <span className="text-2xl">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-sm font-semibold truncate">
                            {entry.subject}
                          </p>
                          <p className="text-cream/40 text-xs">
                            {timeAgo(entry.completed_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className="font-bebas text-lg leading-none"
                            style={{ color }}
                          >
                            {entry.correct_answers}/{entry.total_questions}
                          </p>
                          <p className="text-gold text-[10px] mt-0.5">
                            +{entry.coins_earned} &#x1FA99;
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Leaderboard Preview */}
            <div
              className="rounded-2xl border border-white/10 p-5 animate-slide-up"
              style={{
                animationDelay: "0.4s",
                background: "linear-gradient(135deg, #0d1528 0%, #060c18 100%)",
              }}
            >
              <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">
                TOP GRINDERS
              </h2>
              <div className="space-y-3">
                {leaderboard.map((entry, i) => (
                  <div
                    key={entry.user_id}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors"
                  >
                    <span className="text-2xl">{rankMedals[i] ?? `#${entry.rank}`}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-cream text-sm font-semibold truncate">
                        {entry.username}
                      </p>
                      <p className="text-cream/40 text-xs">
                        &#x1F525; {entry.streak} streak
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bebas text-lg text-gold leading-none">
                        {formatCoins(entry.coins_this_week)}
                      </p>
                      <p className="text-cream/30 text-[10px]">this week</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => router.push("/leaderboard")}
                className="w-full mt-4 text-center text-electric text-sm font-syne font-semibold
                  hover:text-electric-light transition-colors"
              >
                View Full Leaderboard &rarr;
              </button>
            </div>
          </div>

          {/* ── 7. Daily Missions ── */}
          <div className="animate-slide-up" style={{ animationDelay: "0.45s" }}>
            <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">
              DAILY MISSIONS
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  mission: "Complete 1 Daily Quiz",
                  reward: 5,
                  icon: "\u{1F9E0}",
                  color: "#EAB308",
                },
                {
                  mission: "Get a 5-question streak",
                  reward: 10,
                  icon: "\u{1F525}",
                  color: "#F97316",
                },
                {
                  mission: "Try a new subject",
                  reward: 15,
                  icon: "\u{1F31F}",
                  color: "#A855F7",
                },
              ].map((m) => (
                <div
                  key={m.mission}
                  className="flex items-center gap-3 p-4 rounded-2xl border transition-colors hover:bg-white/5"
                  style={{
                    background: `linear-gradient(135deg, ${m.color}08 0%, #060c18 100%)`,
                    borderColor: `${m.color}20`,
                  }}
                >
                  {/* Unchecked circle */}
                  <div
                    className="w-8 h-8 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                    style={{ borderColor: `${m.color}40` }}
                  >
                    <span className="text-base">{m.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-cream text-sm font-semibold truncate">
                      {m.mission}
                    </p>
                    <p className="text-gold text-xs mt-0.5">
                      +{m.reward} bonus &#x1FA99;
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showNinny && <NinnyModal onClose={() => setShowNinny(false)} />}
      {showPractice && (
        <ComingSoonModal onClose={() => setShowPractice(false)} />
      )}
    </ProtectedRoute>
  );
}
