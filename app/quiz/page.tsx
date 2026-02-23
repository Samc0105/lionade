"use client";

import { useState, useCallback, useEffect } from "react";
import { Subject } from "@/types";
import { SUBJECT_ICONS, SUBJECT_COLORS, formatCoins } from "@/lib/mockData";
import { getQuestions, saveQuizSession, saveUserAnswer, incrementCoins, incrementXP, getSubjectStats, getQuizHistory } from "@/lib/db";
import QuizCard from "@/components/QuizCard";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

const QUIZ_CARD_COLORS: Record<Subject, string> = {
  Math: "#EF4444",
  Science: "#22C55E",
  Languages: "#3B82F6",
  "SAT/ACT": "#A855F7",
  Coding: "#6B7280",
  Finance: "#EAB308",
  Certifications: "#F97316",
};

interface Topic {
  name: string;
  subject: Subject;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  topics: Topic[];
}

const CATEGORIES: Category[] = [
  {
    id: "math", name: "Math", icon: "📐", color: "#EF4444",
    topics: [
      { name: "Algebra", subject: "Math" as Subject },
      { name: "Geometry", subject: "Math" as Subject },
      { name: "Calculus", subject: "Math" as Subject },
      { name: "Statistics", subject: "Math" as Subject },
      { name: "Trigonometry", subject: "Math" as Subject },
    ],
  },
  {
    id: "science", name: "Science", icon: "🔬", color: "#22C55E",
    topics: [
      { name: "Biology", subject: "Science" as Subject },
      { name: "Chemistry", subject: "Science" as Subject },
      { name: "Physics", subject: "Science" as Subject },
      { name: "Earth Science", subject: "Science" as Subject },
      { name: "Astronomy", subject: "Science" as Subject },
    ],
  },
  {
    id: "languages", name: "Languages", icon: "🌍", color: "#3B82F6",
    topics: [
      { name: "Spanish", subject: "Languages" as Subject },
      { name: "French", subject: "Languages" as Subject },
      { name: "German", subject: "Languages" as Subject },
      { name: "Japanese", subject: "Languages" as Subject },
      { name: "English Grammar", subject: "Languages" as Subject },
    ],
  },
  {
    id: "humanities", name: "Humanities", icon: "📚", color: "#A855F7",
    topics: [
      { name: "World History", subject: "SAT/ACT" as Subject },
      { name: "US History", subject: "SAT/ACT" as Subject },
      { name: "Geography", subject: "SAT/ACT" as Subject },
      { name: "Philosophy", subject: "SAT/ACT" as Subject },
    ],
  },
  {
    id: "tech", name: "Tech & Coding", icon: "💻", color: "#6B7280",
    topics: [
      { name: "Python", subject: "Coding" as Subject },
      { name: "JavaScript", subject: "Coding" as Subject },
      { name: "Data Structures", subject: "Coding" as Subject },
      { name: "Web Development", subject: "Coding" as Subject },
      { name: "SQL & Databases", subject: "Coding" as Subject },
    ],
  },
  {
    id: "cloud", name: "Cloud & IT", icon: "☁️", color: "#F97316",
    topics: [
      { name: "AWS", subject: "Certifications" as Subject },
      { name: "Azure", subject: "Certifications" as Subject },
      { name: "CompTIA", subject: "Certifications" as Subject },
      { name: "Networking", subject: "Certifications" as Subject },
      { name: "Cybersecurity", subject: "Certifications" as Subject },
    ],
  },
  {
    id: "finance", name: "Finance & Business", icon: "💰", color: "#EAB308",
    topics: [
      { name: "Personal Finance", subject: "Finance" as Subject },
      { name: "Investing", subject: "Finance" as Subject },
      { name: "Accounting", subject: "Finance" as Subject },
      { name: "Economics", subject: "Finance" as Subject },
      { name: "Entrepreneurship", subject: "Finance" as Subject },
    ],
  },
  {
    id: "testprep", name: "Test Prep", icon: "📝", color: "#EC4899",
    topics: [
      { name: "SAT Reading", subject: "SAT/ACT" as Subject },
      { name: "SAT Math", subject: "SAT/ACT" as Subject },
      { name: "ACT Science", subject: "SAT/ACT" as Subject },
      { name: "ACT English", subject: "SAT/ACT" as Subject },
      { name: "AP Exams", subject: "SAT/ACT" as Subject },
    ],
  },
];

type Phase = "select" | "loading" | "quiz" | "results";
type Difficulty = "easy" | "medium" | "hard";

interface DbQuestion {
  id: string;
  subject: string;
  question: string;
  options: string[];
  correct_answer: number;
  difficulty: string;
  coin_reward: number;
  explanation: string | null;
}

interface QuizState {
  correct: number;
  wrong: number;
  totalCoins: number;
  xpEarned: number;
  answers: { questionId: string; selected: number; correct: boolean; timeLeft: number }[];
}

interface SubjectStatEntry {
  subject: string;
  questionsAnswered: number;
  correctAnswers: number;
  coinsEarned: number;
}

interface QuizHistoryEntry {
  id: string;
  subject: string;
  total_questions: number;
  correct_answers: number;
  coins_earned: number;
  completed_at: string;
}

export default function QuizPage() {
  const { user, isLoading, refreshUser } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("select");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [questions, setQuestions] = useState<DbQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [quizState, setQuizState] = useState<QuizState>({
    correct: 0, wrong: 0, totalCoins: 0, xpEarned: 0, answers: [],
  });

  // New state for select phase enhancements
  const [blitzMode, setBlitzMode] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [subjectStats, setSubjectStats] = useState<SubjectStatEntry[]>([]);
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  // Fetch stats on mount
  useEffect(() => {
    if (!user) return;
    getSubjectStats(user.id).then(setSubjectStats).catch(() => {});
    getQuizHistory(user.id, 100).then(setQuizHistory).catch(() => {});
  }, [user]);

  if (isLoading || !user) return null;

  const startQuiz = async (s: Subject) => {
    setSubject(s);
    setPhase("loading");
    try {
      const qs = await getQuestions(s);
      if (qs.length === 0) {
        alert("No questions available for this subject yet. Try another!");
        setPhase("select");
        return;
      }
      setQuestions(qs);
      setCurrentIndex(0);
      setQuizState({ correct: 0, wrong: 0, totalCoins: 0, xpEarned: 0, answers: [] });
      setPhase("quiz");
    } catch {
      setPhase("select");
    }
  };

  const handleAnswer = useCallback(
    async (answerIndex: number, isCorrect: boolean, timeLeft: number) => {
      const q = questions[currentIndex];
      const speedBonus = timeLeft > 12 ? 10 : timeLeft > 8 ? 5 : 0;
      const baseCoins = isCorrect ? q.coin_reward + speedBonus : 0;
      const coinsEarned = blitzMode ? baseCoins * 2 : baseCoins;
      const xp = isCorrect ? q.coin_reward * 2 : 5;

      const newAnswers = [
        ...quizState.answers,
        { questionId: q.id, selected: answerIndex, correct: isCorrect, timeLeft },
      ];

      setQuizState((prev) => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1),
        totalCoins: prev.totalCoins + coinsEarned,
        xpEarned: prev.xpEarned + xp,
        answers: newAnswers,
      }));

      const isLast = currentIndex + 1 >= questions.length;

      setTimeout(async () => {
        if (isLast) {
          // Save session to Supabase
          const totalCoins = quizState.totalCoins + coinsEarned;
          const totalXp = quizState.xpEarned + xp;
          const totalCorrect = quizState.correct + (isCorrect ? 1 : 0);

          try {
            const session = await saveQuizSession({
              user_id: user.id,
              subject: subject!,
              total_questions: questions.length,
              correct_answers: totalCorrect,
              coins_earned: totalCoins,
              xp_earned: totalXp,
              streak_bonus: false,
            });
            setSessionId(session.id);

            // Save individual answers
            await Promise.all(newAnswers.map(a =>
              saveUserAnswer({
                session_id: session.id,
                question_id: a.questionId,
                selected_answer: a.selected,
                is_correct: a.correct,
                time_left: a.timeLeft,
              }).catch(() => {})
            ));

            await refreshUser();
          } catch (err) {
            console.error("Failed to save session", err);
          }

          setPhase("results");
        } else {
          setCurrentIndex((prev) => prev + 1);
        }
      }, 1600);
    },
    [currentIndex, questions, quizState, subject, user.id, refreshUser, blitzMode]
  );

  const restartQuiz = () => {
    setPhase("select");
    setSubject(null);
    setQuestions([]);
    setCurrentIndex(0);
    setSessionId(null);
    setQuizState({ correct: 0, wrong: 0, totalCoins: 0, xpEarned: 0, answers: [] });
  };

  const accuracy = quizState.answers.length > 0
    ? Math.round((quizState.correct / quizState.answers.length) * 100)
    : 0;

  const getRank = (acc: number) => {
    if (acc === 100) return { label: "PERFECT", icon: "\u{1F48E}", color: "#FFD700" };
    if (acc >= 80)  return { label: "ELITE",   icon: "\u{1F525}", color: "#4A90D9" };
    if (acc >= 60)  return { label: "SOLID",   icon: "\u{1F44D}", color: "#2ECC71" };
    return { label: "KEEP GRINDING", icon: "\u{1F4AA}", color: "#E67E22" };
  };

  // Helper: get stats for a subject
  const getStatForSubject = (s: Subject) => {
    return subjectStats.find((st) => st.subject === s);
  };

  // Compute recommendations based on categories/topics
  const recommendations: { category: Category; topic: Topic; reason: string }[] = [];
  for (const cat of CATEGORIES) {
    if (recommendations.length >= 2) break;
    for (const topic of cat.topics) {
      if (recommendations.length >= 2) break;
      const stat = getStatForSubject(topic.subject);
      if (!stat) {
        recommendations.push({ category: cat, topic, reason: `You haven\u2019t tried ${topic.subject} yet \u2014 start with ${topic.name}!` });
        break; // one recommendation per category max
      } else if (stat.questionsAnswered > 0) {
        const acc = Math.round((stat.correctAnswers / stat.questionsAnswered) * 100);
        if (acc < 60) {
          recommendations.push({ category: cat, topic, reason: `Your ${topic.subject} accuracy is ${acc}% \u2014 try ${topic.name}!` });
          break;
        }
      }
    }
  }

  // Quick stats computation
  const totalQuizzes = quizHistory.length;
  const totalCorrectAll = quizHistory.reduce((s, h) => s + h.correct_answers, 0);
  const totalQuestionsAll = quizHistory.reduce((s, h) => s + h.total_questions, 0);
  const avgAccuracy = totalQuestionsAll > 0 ? Math.round((totalCorrectAll / totalQuestionsAll) * 100) : 0;
  const totalCoinsEarned = quizHistory.reduce((s, h) => s + h.coins_earned, 0);
  const subjectCounts: Record<string, number> = {};
  for (const h of quizHistory) {
    subjectCounts[h.subject] = (subjectCounts[h.subject] ?? 0) + 1;
  }
  const favoriteSubject = Object.entries(subjectCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "None yet";

  const timerLimit = blitzMode ? 10 : 20;

  // ── Select ────────────────────────────────────────────────
  if (phase === "select") {
    const activeCategory = CATEGORIES.find((c) => c.id === expandedCategory);

    return (
      <div className="min-h-screen bg-navy pt-20">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="text-center mb-8 animate-slide-up">
            <span className="inline-flex items-center gap-2 bg-electric/10 border border-electric/30 rounded-full px-4 py-1.5 text-electric text-sm font-semibold mb-6">
              &#x26A1; Daily Quiz
            </span>
            <h1 className="font-bebas text-6xl sm:text-7xl text-cream tracking-wider mb-4">
              PICK YOUR<br /><span className="shimmer-text">BATTLEFIELD</span>
            </h1>
            <p className="text-cream/50 text-base">10 questions. Timer per question. Coins on every correct answer.</p>
          </div>

          {/* ── Blitz Mode Card ── */}
          <div className="animate-slide-up mb-6" style={{ animationDelay: "0.05s" }}>
            <button
              onClick={() => setBlitzMode(!blitzMode)}
              className="w-full p-4 rounded-2xl border transition-all duration-300 text-left flex items-center gap-4 cursor-pointer"
              style={{
                background: blitzMode
                  ? "linear-gradient(135deg, #EAB30820 0%, #FFD70010 100%)"
                  : "linear-gradient(135deg, #EAB30808 0%, #060c18 100%)",
                borderColor: blitzMode ? "#EAB30860" : "#EAB30825",
                boxShadow: blitzMode ? "0 0 30px #EAB30820, 0 0 60px #EAB30810" : "none",
              }}
            >
              <span className="text-3xl">&#x26A1;</span>
              <div className="flex-1">
                <p className="font-bebas text-xl text-[#EAB308] tracking-wider">
                  BLITZ MODE
                </p>
                <p className="text-cream/40 text-xs font-syne">
                  2x Coins, Shorter Timer (10s)
                </p>
              </div>
              {blitzMode && (
                <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-[#EAB308]/20 border border-[#EAB308]/40 text-[#EAB308]">
                  Active
                </span>
              )}
              <div
                className="w-12 h-7 rounded-full relative transition-all duration-300"
                style={{
                  background: blitzMode ? "#EAB308" : "#ffffff15",
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-300"
                  style={{ left: blitzMode ? "24px" : "4px" }}
                />
              </div>
            </button>
          </div>

          {/* ── Difficulty Selector ── */}
          <div className="animate-slide-up mb-8" style={{ animationDelay: "0.08s" }}>
            <div className="flex items-center gap-3 justify-center">
              {([
                { d: "easy" as Difficulty, label: "Easy", color: "#22C55E" },
                { d: "medium" as Difficulty, label: "Medium", color: "#EAB308" },
                { d: "hard" as Difficulty, label: "Hard", color: "#EF4444" },
              ]).map(({ d, label, color }) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className="px-5 py-2 rounded-xl font-bebas text-lg tracking-wider transition-all duration-200 border cursor-pointer"
                  style={{
                    background: difficulty === d ? `${color}20` : "transparent",
                    borderColor: difficulty === d ? `${color}60` : "#ffffff15",
                    color: difficulty === d ? color : "#ffffff40",
                    boxShadow: difficulty === d ? `0 0 15px ${color}15` : "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-cream/30 text-xs text-center mt-2 font-syne">
              Harder difficulty = more coins per correct answer
            </p>
          </div>

          {/* ── Recommendations ── */}
          {recommendations.length > 0 && !expandedCategory && (
            <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">
                RECOMMENDED FOR YOU
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recommendations.map((rec) => {
                  const color = rec.category.color;
                  return (
                    <button
                      key={rec.topic.name}
                      onClick={() => startQuiz(rec.topic.subject)}
                      className="flex items-center gap-3 p-4 rounded-2xl border text-left transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
                      style={{
                        background: `linear-gradient(135deg, ${color}10 0%, #060c18 100%)`,
                        borderColor: `${color}30`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = `0 0 20px ${color}20`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <span className="text-3xl">{rec.category.icon}</span>
                      <div>
                        <p className="font-bebas text-lg tracking-wider" style={{ color }}>
                          {rec.topic.name}
                        </p>
                        <p className="text-cream/40 text-xs font-syne">{rec.reason}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Category Grid (no category expanded) ── */}
          {!expandedCategory && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              {CATEGORIES.map((cat, i) => (
                <button
                  key={cat.id}
                  onClick={() => setExpandedCategory(cat.id)}
                  className="group relative p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-1 text-left animate-slide-up cursor-pointer"
                  style={{
                    animationDelay: `${0.12 + i * 0.04}s`,
                    border: `1px solid ${cat.color}30`,
                    background: `linear-gradient(135deg, ${cat.color}08 0%, #060c18 100%)`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = `0 0 25px ${cat.color}20, 0 8px 32px ${cat.color}10`;
                    e.currentTarget.style.borderColor = `${cat.color}60`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.borderColor = `${cat.color}30`;
                  }}
                >
                  <span className="text-4xl block mb-3 group-hover:scale-110 transition-transform duration-300">
                    {cat.icon}
                  </span>
                  <p className="font-bebas text-xl text-cream tracking-wider">{cat.name}</p>
                  <p className="text-xs mt-1" style={{ color: `${cat.color}cc` }}>
                    {cat.topics.length} topics
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* ── Expanded Subtopic View ── */}
          {activeCategory && (
            <div className="mb-10 animate-slide-up">
              {/* Back button */}
              <button
                onClick={() => setExpandedCategory(null)}
                className="flex items-center gap-2 text-cream/50 hover:text-cream transition-colors mb-6 cursor-pointer font-syne text-sm"
              >
                <span>&larr;</span> Back to Categories
              </button>

              {/* Category header */}
              <div className="flex items-center gap-4 mb-6">
                <span className="text-5xl">{activeCategory.icon}</span>
                <div>
                  <h2 className="font-bebas text-3xl tracking-wider" style={{ color: activeCategory.color }}>
                    {activeCategory.name}
                  </h2>
                  <p className="text-cream/40 text-sm font-syne">
                    {activeCategory.topics.length} topics available
                  </p>
                </div>
              </div>

              {/* Subtopic grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {activeCategory.topics.map((topic, i) => {
                  const color = activeCategory.color;
                  const stat = getStatForSubject(topic.subject);
                  const bestScore = stat
                    ? (() => {
                        const subjectQuizzes = quizHistory.filter((h) => h.subject === topic.subject);
                        if (subjectQuizzes.length === 0) return null;
                        const best = subjectQuizzes.reduce((a, b) =>
                          b.correct_answers / b.total_questions > a.correct_answers / a.total_questions ? b : a
                        );
                        return { correct: best.correct_answers, total: best.total_questions };
                      })()
                    : null;
                  const subjectAccuracy = stat && stat.questionsAnswered > 0
                    ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100)
                    : 0;

                  return (
                    <button
                      key={topic.name}
                      onClick={() => startQuiz(topic.subject)}
                      className="group relative p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-1 text-left animate-slide-up cursor-pointer"
                      style={{
                        animationDelay: `${i * 0.05}s`,
                        border: `1px solid ${color}30`,
                        background: `linear-gradient(135deg, ${color}08 0%, #060c18 100%)`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = `0 0 25px ${color}20, 0 8px 32px ${color}10`;
                        e.currentTarget.style.borderColor = `${color}60`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = "none";
                        e.currentTarget.style.borderColor = `${color}30`;
                      }}
                    >
                      <p className="font-bebas text-xl text-cream tracking-wider mb-1">{topic.name}</p>
                      <span
                        className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mb-3"
                        style={{
                          background: `${color}15`,
                          border: `1px solid ${color}30`,
                          color: `${color}cc`,
                        }}
                      >
                        {topic.subject}
                      </span>

                      {/* Per-topic stats (from mapped subject) */}
                      <div className="pt-3 border-t border-white/5">
                        {bestScore ? (
                          <>
                            <p className="text-cream/50 text-[11px]">
                              Best: <span className="font-bold text-cream/70">{bestScore.correct}/{bestScore.total}</span>
                            </p>
                            <div className="w-full h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${subjectAccuracy}%`,
                                  background: color,
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          <p className="text-cream/30 text-[11px]">Not attempted yet</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Quick Stats ── */}
          <div className="animate-slide-up" style={{ animationDelay: "0.5s" }}>
            <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">
              QUICK STATS
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Quizzes", value: totalQuizzes.toString(), icon: "\u{1F4CA}", color: "#4A90D9" },
                { label: "Avg Accuracy", value: `${avgAccuracy}%`, icon: "\u{1F3AF}", color: "#22C55E" },
                { label: "Favorite", value: favoriteSubject, icon: "\u{2B50}", color: "#A855F7" },
                { label: "Coins Earned", value: formatCoins(totalCoinsEarned), icon: "\u{1FA99}", color: "#FFD700" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-4 rounded-2xl border text-center"
                  style={{
                    background: `linear-gradient(135deg, ${stat.color}08 0%, #060c18 100%)`,
                    borderColor: `${stat.color}20`,
                  }}
                >
                  <span className="text-2xl block mb-1">{stat.icon}</span>
                  <p className="font-bebas text-2xl leading-none" style={{ color: stat.color }}>
                    {stat.value}
                  </p>
                  <p className="text-cream/40 text-[10px] uppercase tracking-wider mt-1">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full border-2 border-electric border-t-transparent animate-spin mx-auto mb-4" />
          <p className="font-bebas text-2xl text-electric tracking-widest">LOADING QUESTIONS...</p>
        </div>
      </div>
    );
  }

  // ── Quiz ──────────────────────────────────────────────────
  if (phase === "quiz" && subject && questions[currentIndex]) {
    const q = questions[currentIndex];
    const subjectColor = SUBJECT_COLORS[subject];

    // Convert DB question to component format
    const questionForCard = {
      id: q.id,
      subject: q.subject as Subject,
      question: q.question,
      options: q.options,
      correctAnswer: q.correct_answer,
      difficulty: q.difficulty as "easy" | "medium" | "hard",
      coinReward: blitzMode ? q.coin_reward * 2 : q.coin_reward,
      explanation: q.explanation ?? undefined,
    };

    return (
      <div className="min-h-screen bg-navy pt-20">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{SUBJECT_ICONS[subject]}</span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bebas text-xl text-cream tracking-wider">{subject}</p>
                  {blitzMode && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#EAB308]/20 border border-[#EAB308]/40 text-[#EAB308]">
                      &#x26A1; Blitz
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-1">
                  {questions.map((_, i) => (
                    <div key={i} className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: i === currentIndex ? "20px" : "8px",
                        background: i < currentIndex
                          ? (quizState.answers[i]?.correct ? "#2ECC71" : "#E74C3C")
                          : i === currentIndex ? subjectColor : "#4A90D920",
                      }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green-400 font-bold">{quizState.correct} &#x2713;</span>
              <span className="text-red-400 font-bold">{quizState.wrong} &#x2717;</span>
              <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/30 rounded-full px-3 py-1">
                <span>&#x1FA99;</span>
                <span className="font-bebas text-lg text-gold">{quizState.totalCoins}</span>
              </div>
            </div>
          </div>

          <QuizCard
            key={q.id}
            question={questionForCard}
            questionNumber={currentIndex + 1}
            totalQuestions={questions.length}
            timeLimit={timerLimit}
            onAnswer={handleAnswer}
          />
        </div>
      </div>
    );
  }

  // ── Results ───────────────────────────────────────────────
  if (phase === "results") {
    const rank = getRank(accuracy);
    return (
      <div className="min-h-screen bg-navy pt-20">
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex flex-col items-center justify-center w-32 h-32 rounded-full border-4 mb-8 animate-slide-up"
            style={{ borderColor: rank.color, background: `radial-gradient(circle, ${rank.color}20 0%, transparent 70%)`, boxShadow: `0 0 40px ${rank.color}40` }}>
            <span className="text-5xl">{rank.icon}</span>
          </div>

          <h1 className="font-bebas text-6xl text-cream tracking-wider mb-2">{rank.label}</h1>
          <p className="text-cream/50 text-base mb-8">
            {subject} Quiz Complete
            {blitzMode && <span className="text-[#EAB308] ml-2">&#x26A1; Blitz Mode</span>}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              { icon: "\u2705", label: "Correct", value: quizState.correct, color: "text-green-400" },
              { icon: "\u274C", label: "Wrong",   value: quizState.wrong,   color: "text-red-400" },
              { icon: "\u{1FA99}", label: "Coins",   value: quizState.totalCoins, color: "text-gold" },
              { icon: "\u26A1", label: "XP",      value: quizState.xpEarned, color: "text-electric" },
            ].map((s) => (
              <div key={s.label} className="stat-box py-5">
                <span className="text-2xl">{s.icon}</span>
                <p className={`font-bebas text-4xl leading-none ${s.color}`}>{s.value}</p>
                <p className="text-cream/40 text-xs">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="card mb-6 text-left">
            <h3 className="font-bebas text-xl text-cream tracking-wider mb-3">ANSWER BREAKDOWN</h3>
            <div className="flex gap-1 mb-3">
              {quizState.answers.map((a, i) => (
                <div key={i} className="flex-1 h-8 rounded flex items-center justify-center text-xs font-bold"
                  style={{ background: a.correct ? "#2ECC7130" : "#E74C3C30", border: `1px solid ${a.correct ? "#2ECC71" : "#E74C3C"}` }}>
                  {a.correct ? "\u2713" : "\u2717"}
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-cream/50">Accuracy</span>
              <span className="font-bebas text-2xl" style={{ color: rank.color }}>{accuracy}%</span>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full mt-2 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${accuracy}%`, background: rank.color }} />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={restartQuiz} className="btn-outline flex-1 py-3">&#x1F504; New Quiz</button>
            <Link href="/duel" className="flex-1"><button className="btn-primary w-full py-3">&#x2694;&#xFE0F; Duel</button></Link>
            <Link href="/dashboard" className="flex-1"><button className="btn-gold w-full py-3">&#x1F3E0; Dashboard</button></Link>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
