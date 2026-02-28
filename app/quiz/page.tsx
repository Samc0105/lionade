"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Subject } from "@/types";
import { SUBJECT_ICONS, SUBJECT_COLORS, formatCoins } from "@/lib/mockData";
import { getQuizQuestions, checkAnswer, saveQuizSession, saveUserAnswer, getSubjectStats, getQuizHistory } from "@/lib/db";
import QuizCard from "@/components/QuizCard";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";

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

const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = { easy: 1, medium: 1.5, hard: 2 };

interface QuizQuestion {
  id: string;
  subject: string;
  question: string;
  options: string[];
  difficulty: string;
}

interface AnswerRecord {
  questionId: string;
  selected: number;
  correct: boolean;
  timeLeft: number;
  questionText: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
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
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [totalCoins, setTotalCoins] = useState(0);
  const [totalXp, setTotalXp] = useState(0);

  const [blitzMode, setBlitzMode] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [subjectStats, setSubjectStats] = useState<SubjectStatEntry[]>([]);
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Anti-cheat: result comes back from server after user selects
  const [currentResult, setCurrentResult] = useState<{ correctIndex: number; explanation: string | null } | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMistakes, setShowMistakes] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  useEffect(() => {
    if (!user) return;
    getSubjectStats(user.id).then(setSubjectStats).catch(() => {});
    getQuizHistory(user.id, 100).then(setQuizHistory).catch(() => {});
  }, [user]);

  if (isLoading || !user) return null;

  const diffMult = DIFFICULTY_MULTIPLIER[difficulty];
  const blitzMult = blitzMode ? 2 : 1;

  const startQuiz = async (s: Subject) => {
    setSubject(s);
    setPhase("loading");
    try {
      const qs = await getQuizQuestions(s, difficulty);
      if (qs.length === 0) {
        alert("No questions available for this subject + difficulty yet. Try another!");
        setPhase("select");
        return;
      }
      setQuestions(qs);
      setCurrentIndex(0);
      setAnswers([]);
      setTotalCoins(0);
      setTotalXp(0);
      setCurrentResult(null);
      setPhase("quiz");
    } catch {
      setPhase("select");
    }
  };

  const handleSelect = useCallback(
    async (answerIndex: number, timeLeft: number) => {
      // Skip signal from QuizCard "Next" button
      if (answerIndex === -99) {
        if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
        advanceToNext();
        return;
      }

      const q = questions[currentIndex];

      // Fetch correct answer from server (anti-cheat)
      try {
        const { correct_answer, explanation } = await checkAnswer(q.id);
        const isCorrect = answerIndex === correct_answer;

        // Calculate rewards
        const coinReward = isCorrect ? Math.round(1 * diffMult * blitzMult) : 0;
        const xpReward = isCorrect ? Math.round(10 * diffMult * blitzMult) : 0;

        const newAnswer: AnswerRecord = { questionId: q.id, selected: answerIndex, correct: isCorrect, timeLeft, questionText: q.question, options: q.options, correctIndex: correct_answer, explanation };
        const updatedAnswers = [...answers, newAnswer];
        setAnswers(updatedAnswers);
        setTotalCoins((prev) => prev + coinReward);
        setTotalXp((prev) => prev + xpReward);
        setCurrentResult({ correctIndex: correct_answer, explanation });

        // Auto-advance after delay
        const delay = explanation ? 3000 : 1400;
        advanceTimerRef.current = setTimeout(() => {
          advanceAfterAnswer(updatedAnswers);
        }, delay);
      } catch (err) {
        console.error("Failed to check answer", err);
      }
    },
    [currentIndex, questions, answers, diffMult, blitzMult]
  );

  function advanceToNext() {
    const isLast = currentIndex + 1 >= questions.length;
    if (isLast) {
      finishQuiz(answers);
    } else {
      setCurrentIndex((prev) => prev + 1);
      setCurrentResult(null);
    }
  }

  function advanceAfterAnswer(updatedAnswers: AnswerRecord[]) {
    const isLast = currentIndex + 1 >= questions.length;
    if (isLast) {
      finishQuiz(updatedAnswers);
    } else {
      setCurrentIndex((prev) => prev + 1);
      setCurrentResult(null);
    }
  }

  async function finishQuiz(finalAnswers: AnswerRecord[]) {
    const correctCount = finalAnswers.filter((a) => a.correct).length;
    let coins = finalAnswers.reduce((sum, a) => sum + (a.correct ? Math.round(1 * diffMult * blitzMult) : 0), 0);
    const xp = finalAnswers.reduce((sum, a) => sum + (a.correct ? Math.round(10 * diffMult * blitzMult) : 0), 0);

    // Perfect score bonus
    if (correctCount === questions.length && questions.length === 10) {
      coins += 5;
    }

    setTotalCoins(coins);
    setTotalXp(xp);

    console.log("[Quiz] finishQuiz called — user:", user!.id, "coins:", coins, "xp:", xp, "correct:", correctCount);
    try {
      const session = await saveQuizSession({
        user_id: user!.id,
        subject: subject!,
        total_questions: questions.length,
        correct_answers: correctCount,
        coins_earned: coins,
        xp_earned: xp,
        streak_bonus: false,
      });
      console.log("[Quiz] saveQuizSession succeeded, session id:", session.id);

      await Promise.all(finalAnswers.map((a) =>
        saveUserAnswer({
          session_id: session.id,
          question_id: a.questionId,
          selected_answer: a.selected,
          is_correct: a.correct,
          time_left: a.timeLeft,
        }).catch((err) => console.error("[Quiz] saveUserAnswer failed:", err))
      ));

      console.log("[Quiz] Calling refreshUser...");
      await refreshUser();
      console.log("[Quiz] refreshUser completed");
    } catch (err) {
      console.error("[Quiz] FAILED to save session:", err);
    }

    setPhase("results");
  }

  const restartQuiz = () => {
    setPhase("select");
    setSubject(null);
    setQuestions([]);
    setCurrentIndex(0);
    setAnswers([]);
    setTotalCoins(0);
    setTotalXp(0);
    setCurrentResult(null);
    setShowMistakes(false);
  };

  const correctCount = answers.filter((a) => a.correct).length;
  const wrongCount = answers.filter((a) => !a.correct).length;
  const accuracy = answers.length > 0 ? Math.round((correctCount / answers.length) * 100) : 0;

  const getRank = (acc: number) => {
    if (acc === 100) return { label: "PERFECT", icon: "\u{1F48E}", color: "#FFD700" };
    if (acc >= 80)  return { label: "ELITE",   icon: "\u{1F525}", color: "#4A90D9" };
    if (acc >= 60)  return { label: "SOLID",   icon: "\u{1F44D}", color: "#2ECC71" };
    return { label: "KEEP GRINDING", icon: "\u{1F4AA}", color: "#E67E22" };
  };

  const getStatForSubject = (s: Subject) => subjectStats.find((st) => st.subject === s);

  const recommendations: { category: Category; topic: Topic; reason: string }[] = [];
  for (const cat of CATEGORIES) {
    if (recommendations.length >= 2) break;
    for (const topic of cat.topics) {
      if (recommendations.length >= 2) break;
      const stat = getStatForSubject(topic.subject);
      if (!stat) {
        recommendations.push({ category: cat, topic, reason: `You haven\u2019t tried ${topic.subject} yet \u2014 start with ${topic.name}!` });
        break;
      } else if (stat.questionsAnswered > 0) {
        const acc = Math.round((stat.correctAnswers / stat.questionsAnswered) * 100);
        if (acc < 60) {
          recommendations.push({ category: cat, topic, reason: `Your ${topic.subject} accuracy is ${acc}% \u2014 try ${topic.name}!` });
          break;
        }
      }
    }
  }

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

  const timerLimit = blitzMode ? 10 : 15;

  // Coin reward display for current question
  const currentCoinReward = Math.round(1 * diffMult * blitzMult);

  // ── Select ────────────────────────────────────────────────
  if (phase === "select") {
    const activeCategory = CATEGORIES.find((c) => c.id === expandedCategory);

    return (
      <div className="min-h-screen pt-20">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <BackButton />
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
                <p className="font-bebas text-xl text-[#EAB308] tracking-wider">BLITZ MODE</p>
                <p className="text-cream/40 text-xs font-syne">2x Coins & XP, Shorter Timer (10s)</p>
              </div>
              {blitzMode && (
                <span className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-[#EAB308]/20 border border-[#EAB308]/40 text-[#EAB308]">
                  Active
                </span>
              )}
              <div className="w-12 h-7 rounded-full relative transition-all duration-300" style={{ background: blitzMode ? "#EAB308" : "#ffffff15" }}>
                <div className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-300" style={{ left: blitzMode ? "24px" : "4px" }} />
              </div>
            </button>
          </div>

          {/* ── Difficulty Selector ── */}
          <div className="animate-slide-up mb-8" style={{ animationDelay: "0.08s" }}>
            <div className="grid grid-cols-3 gap-3">
              {([
                { d: "easy" as Difficulty, label: "Beginner", icon: "\uD83D\uDFE2", color: "#22C55E", desc: "Fundamentals and basics", mult: "1x" },
                { d: "medium" as Difficulty, label: "Intermediate", icon: "\uD83D\uDFE1", color: "#EAB308", desc: "Deeper concepts and application", mult: "1.5x" },
                { d: "hard" as Difficulty, label: "Advanced", icon: "\uD83D\uDD34", color: "#EF4444", desc: "Expert-level challenges", mult: "2x" },
              ]).map(({ d, label, icon, color, desc, mult }) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className="relative p-4 rounded-2xl border-2 transition-all duration-300 text-left cursor-pointer hover:-translate-y-0.5"
                  style={{
                    background: difficulty === d
                      ? `linear-gradient(135deg, ${color}15 0%, ${color}05 100%)`
                      : "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
                    borderColor: difficulty === d ? color : "#ffffff10",
                    boxShadow: difficulty === d ? `0 0 20px ${color}30, 0 0 40px ${color}10` : "none",
                  }}
                >
                  <span className="text-2xl block mb-2">{icon}</span>
                  <p className="font-bebas text-lg tracking-wider" style={{ color: difficulty === d ? color : "#ffffff60" }}>{label}</p>
                  <p className="text-cream/40 text-[11px] leading-tight mt-1">{desc}</p>
                  <span
                    className="inline-block mt-2 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                    style={{ background: `${color}15`, border: `1px solid ${color}30`, color: difficulty === d ? color : `${color}80` }}
                  >
                    {mult} coins
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Recommendations ── */}
          {recommendations.length > 0 && !expandedCategory && (
            <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">RECOMMENDED FOR YOU</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recommendations.map((rec) => {
                  const color = rec.category.color;
                  return (
                    <button
                      key={rec.topic.name}
                      onClick={() => startQuiz(rec.topic.subject)}
                      className="flex items-center gap-3 p-4 rounded-2xl border text-left transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
                      style={{ background: `linear-gradient(135deg, ${color}10 0%, #060c18 100%)`, borderColor: `${color}30` }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 20px ${color}20`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
                    >
                      <span className="text-3xl">{rec.category.icon}</span>
                      <div>
                        <p className="font-bebas text-lg tracking-wider" style={{ color }}>{rec.topic.name}</p>
                        <p className="text-cream/40 text-xs font-syne">{rec.reason}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Category Grid ── */}
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
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 25px ${cat.color}20, 0 8px 32px ${cat.color}10`; e.currentTarget.style.borderColor = `${cat.color}60`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = `${cat.color}30`; }}
                >
                  <span className="text-4xl block mb-3 group-hover:scale-110 transition-transform duration-300">{cat.icon}</span>
                  <p className="font-bebas text-xl text-cream tracking-wider">{cat.name}</p>
                  <p className="text-xs mt-1" style={{ color: `${cat.color}cc` }}>{cat.topics.length} topics</p>
                </button>
              ))}
            </div>
          )}

          {/* ── Expanded Subtopic View ── */}
          {activeCategory && (
            <div className="mb-10 animate-slide-up">
              <button onClick={() => setExpandedCategory(null)} className="flex items-center gap-2 text-cream/50 hover:text-cream transition-colors mb-6 cursor-pointer font-syne text-sm">
                <span>&larr;</span> Back to Categories
              </button>
              <div className="flex items-center gap-4 mb-6">
                <span className="text-5xl">{activeCategory.icon}</span>
                <div>
                  <h2 className="font-bebas text-3xl tracking-wider" style={{ color: activeCategory.color }}>{activeCategory.name}</h2>
                  <p className="text-cream/40 text-sm font-syne">{activeCategory.topics.length} topics available</p>
                </div>
              </div>
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
                    ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100) : 0;

                  return (
                    <button
                      key={topic.name}
                      onClick={() => startQuiz(topic.subject)}
                      className="group relative p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-1 text-left animate-slide-up cursor-pointer"
                      style={{ animationDelay: `${i * 0.05}s`, border: `1px solid ${color}30`, background: `linear-gradient(135deg, ${color}08 0%, #060c18 100%)` }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 25px ${color}20, 0 8px 32px ${color}10`; e.currentTarget.style.borderColor = `${color}60`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = `${color}30`; }}
                    >
                      <p className="font-bebas text-xl text-cream tracking-wider mb-1">{topic.name}</p>
                      <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mb-3"
                        style={{ background: `${color}15`, border: `1px solid ${color}30`, color: `${color}cc` }}>{topic.subject}</span>
                      <div className="pt-3 border-t border-white/5">
                        {bestScore ? (
                          <>
                            <p className="text-cream/50 text-[11px]">Best: <span className="font-bold text-cream/70">{bestScore.correct}/{bestScore.total}</span></p>
                            <div className="w-full h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${subjectAccuracy}%`, background: color }} />
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
            <h2 className="font-bebas text-lg text-cream tracking-wider mb-3">QUICK STATS</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Quizzes", value: totalQuizzes.toString(), icon: "\u{1F4CA}", color: "#4A90D9" },
                { label: "Avg Accuracy", value: `${avgAccuracy}%`, icon: "\u{1F3AF}", color: "#22C55E" },
                { label: "Favorite", value: favoriteSubject, icon: "\u{2B50}", color: "#A855F7" },
                { label: "Coins Earned", value: formatCoins(totalCoinsEarned), icon: "\u{1FA99}", color: "#FFD700" },
              ].map((stat) => (
                <div key={stat.label} className="p-4 rounded-2xl border text-center"
                  style={{ background: `linear-gradient(135deg, ${stat.color}08 0%, #060c18 100%)`, borderColor: `${stat.color}20` }}>
                  <span className="text-2xl block mb-1">{stat.icon}</span>
                  <p className="font-bebas text-2xl leading-none" style={{ color: stat.color }}>{stat.value}</p>
                  <p className="text-cream/40 text-[10px] uppercase tracking-wider mt-1">{stat.label}</p>
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
      <div className="min-h-screen flex items-center justify-center">
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

    return (
      <div className="min-h-screen pt-20">
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
                          ? (answers[i]?.correct ? "#2ECC71" : "#E74C3C")
                          : i === currentIndex ? subjectColor : "#4A90D920",
                      }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green-400 font-bold">{correctCount} &#x2713;</span>
              <span className="text-red-400 font-bold">{wrongCount} &#x2717;</span>
              <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/30 rounded-full px-3 py-1">
                <span>&#x1FA99;</span>
                <span className="font-bebas text-lg text-gold">{totalCoins}</span>
              </div>
            </div>
          </div>

          <QuizCard
            key={q.id}
            question={q}
            questionNumber={currentIndex + 1}
            totalQuestions={questions.length}
            timeLimit={timerLimit}
            coinReward={currentCoinReward}
            onSelect={handleSelect}
            result={currentResult}
          />
        </div>
      </div>
    );
  }

  // ── Results ───────────────────────────────────────────────
  if (phase === "results") {
    const rank = getRank(accuracy);
    const mistakes = answers.filter((a) => !a.correct);

    return (
      <div className="min-h-screen pt-20">
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          {/* Rank Badge */}
          <div
            className="inline-flex flex-col items-center justify-center w-32 h-32 rounded-full mb-8 animate-slide-up"
            style={{
              background: `radial-gradient(circle, ${rank.color}18 0%, transparent 70%)`,
              boxShadow: `0 0 60px ${rank.color}25, inset 0 0 30px ${rank.color}10`,
              border: `2px solid ${rank.color}40`,
            }}
          >
            <span className="text-5xl">{rank.icon}</span>
          </div>

          <h1 className="font-bebas text-6xl text-cream tracking-wider mb-2 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            {rank.label}
          </h1>
          <p className="text-cream/40 text-base mb-10 animate-slide-up" style={{ animationDelay: "0.08s" }}>
            {subject} Quiz Complete
            {blitzMode && <span className="text-[#EAB308] ml-2">&#x26A1; Blitz</span>}
          </p>

          {/* Glass Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 animate-slide-up" style={{ animationDelay: "0.12s" }}>
            {[
              { icon: "\u2705", label: "Correct", value: correctCount, accent: "#2ECC71" },
              { icon: "\u274C", label: "Wrong", value: wrongCount, accent: "#E74C3C" },
              { icon: "\u{1FA99}", label: "Coins", value: totalCoins, accent: "#FFD700" },
              { icon: "\u26A1", label: "XP", value: totalXp, accent: "#4A90D9" },
            ].map((s) => (
              <div
                key={s.label}
                className="relative rounded-2xl p-5 text-center backdrop-blur-xl overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
                }}
              >
                <span className="text-2xl block mb-2">{s.icon}</span>
                <p className="font-bebas text-4xl leading-none" style={{ color: s.accent }}>{s.value}</p>
                <p className="text-cream/35 text-[11px] uppercase tracking-wider mt-1.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Glass Answer Breakdown */}
          <div
            className="rounded-2xl p-5 mb-8 text-left backdrop-blur-xl animate-slide-up"
            style={{
              animationDelay: "0.18s",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">ANSWER BREAKDOWN</h3>
            <div className="flex gap-1.5 mb-4">
              {answers.map((a, i) => (
                <div
                  key={i}
                  className="flex-1 h-9 rounded-lg flex items-center justify-center text-xs font-bold backdrop-blur-sm"
                  style={{
                    background: a.correct ? "rgba(46,204,113,0.12)" : "rgba(231,76,60,0.12)",
                    border: `1px solid ${a.correct ? "rgba(46,204,113,0.35)" : "rgba(231,76,60,0.35)"}`,
                    color: a.correct ? "#2ECC71" : "#E74C3C",
                  }}
                >
                  {a.correct ? "\u2713" : "\u2717"}
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-cream/40 text-sm">Accuracy</span>
              <span className="font-bebas text-2xl" style={{ color: rank.color }}>{accuracy}%</span>
            </div>
            <div className="w-full h-2 bg-white/[0.06] rounded-full mt-2.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${accuracy}%`, background: `linear-gradient(90deg, ${rank.color}cc, ${rank.color})` }}
              />
            </div>
          </div>

          {/* Glass Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 animate-slide-up" style={{ animationDelay: "0.24s" }}>
            <button
              onClick={() => router.push("/learn")}
              className="flex-1 py-3.5 rounded-xl font-syne font-bold text-sm text-cream/90 transition-all duration-200 hover:brightness-125 active:scale-[0.98] backdrop-blur-xl cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              New Quiz
            </button>
            <button
              onClick={() => setShowMistakes(!showMistakes)}
              disabled={mistakes.length === 0}
              className="flex-1 py-3.5 rounded-xl font-syne font-bold text-sm transition-all duration-200 hover:brightness-125 active:scale-[0.98] backdrop-blur-xl cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: mistakes.length > 0 ? "rgba(231,76,60,0.10)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${mistakes.length > 0 ? "rgba(231,76,60,0.25)" : "rgba(255,255,255,0.08)"}`,
                color: mistakes.length > 0 ? "#E74C3C" : "rgba(255,255,255,0.3)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              {showMistakes ? "Hide Mistakes" : `Review Mistakes${mistakes.length > 0 ? ` (${mistakes.length})` : ""}`}
            </button>
            <button
              onClick={() => router.push("/dashboard")}
              className="flex-1 py-3.5 rounded-xl font-syne font-bold text-sm text-cream/90 transition-all duration-200 hover:brightness-125 active:scale-[0.98] backdrop-blur-xl cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              Dashboard
            </button>
          </div>

          {/* Review Mistakes Section */}
          {showMistakes && mistakes.length > 0 && (
            <div className="mt-8 space-y-4 text-left animate-slide-up">
              <h3 className="font-bebas text-xl text-cream tracking-wider text-center mb-2">REVIEW MISTAKES</h3>
              {mistakes.map((m, i) => {
                const optionLabels = ["A", "B", "C", "D"];
                return (
                  <div
                    key={m.questionId}
                    className="rounded-2xl p-5 backdrop-blur-xl"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
                    }}
                  >
                    <p className="text-cream/30 text-xs font-bold uppercase tracking-widest mb-2">
                      Question {answers.indexOf(m) + 1}
                    </p>
                    <p className="text-cream font-syne font-semibold text-sm leading-relaxed mb-4">
                      {m.questionText}
                    </p>

                    <div className="space-y-2 mb-4">
                      {m.options.map((opt, oi) => {
                        const isUserPick = oi === m.selected;
                        const isCorrectOpt = oi === m.correctIndex;

                        let bg = "rgba(255,255,255,0.02)";
                        let border = "rgba(255,255,255,0.06)";
                        let textColor = "rgba(238,244,255,0.35)";

                        if (isCorrectOpt) {
                          bg = "rgba(46,204,113,0.10)";
                          border = "rgba(46,204,113,0.30)";
                          textColor = "#2ECC71";
                        } else if (isUserPick) {
                          bg = "rgba(231,76,60,0.10)";
                          border = "rgba(231,76,60,0.30)";
                          textColor = "#E74C3C";
                        }

                        return (
                          <div
                            key={oi}
                            className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm"
                            style={{ background: bg, border: `1px solid ${border}`, color: textColor }}
                          >
                            <span className="font-bebas text-base w-6 text-center flex-shrink-0">
                              {isCorrectOpt ? "\u2713" : isUserPick ? "\u2717" : optionLabels[oi]}
                            </span>
                            <span className={isCorrectOpt || isUserPick ? "font-semibold" : ""}>{opt}</span>
                            {isUserPick && !isCorrectOpt && (
                              <span className="ml-auto text-[10px] uppercase tracking-widest opacity-60">Your answer</span>
                            )}
                            {isCorrectOpt && (
                              <span className="ml-auto text-[10px] uppercase tracking-widest opacity-60">Correct</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {m.explanation && (
                      <div
                        className="flex items-start gap-2.5 p-3.5 rounded-xl"
                        style={{
                          background: "rgba(74,144,217,0.06)",
                          border: "1px solid rgba(74,144,217,0.15)",
                        }}
                      >
                        <span className="text-base flex-shrink-0">&#x1F4A1;</span>
                        <p className="text-cream/60 text-sm leading-relaxed">{m.explanation}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
