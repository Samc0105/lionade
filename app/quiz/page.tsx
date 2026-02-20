"use client";

import { useState, useCallback, useEffect } from "react";
import { Subject } from "@/types";
import { SUBJECT_ICONS, SUBJECT_COLORS, formatCoins } from "@/lib/mockData";
import { getQuestions, saveQuizSession, saveUserAnswer, incrementCoins, incrementXP } from "@/lib/db";
import QuizCard from "@/components/QuizCard";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

const SUBJECTS: Subject[] = ["Math", "Science", "Languages", "SAT/ACT", "Coding", "Finance", "Certifications"];

type Phase = "select" | "loading" | "quiz" | "results";

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

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

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
      const coinsEarned = isCorrect ? q.coin_reward + speedBonus : 0;
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
    [currentIndex, questions, quizState, subject, user.id, refreshUser]
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
    if (acc === 100) return { label: "PERFECT", icon: "💎", color: "#FFD700" };
    if (acc >= 80)  return { label: "ELITE",   icon: "🔥", color: "#4A90D9" };
    if (acc >= 60)  return { label: "SOLID",   icon: "👍", color: "#2ECC71" };
    return { label: "KEEP GRINDING", icon: "💪", color: "#E67E22" };
  };

  // ── Select ────────────────────────────────────────────────
  if (phase === "select") {
    return (
      <div className="min-h-screen bg-navy pt-20">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="text-center mb-12 animate-slide-up">
            <span className="inline-flex items-center gap-2 bg-electric/10 border border-electric/30 rounded-full px-4 py-1.5 text-electric text-sm font-semibold mb-6">
              ⚡ Daily Quiz
            </span>
            <h1 className="font-bebas text-6xl sm:text-7xl text-cream tracking-wider mb-4">
              PICK YOUR<br /><span className="shimmer-text">BATTLEFIELD</span>
            </h1>
            <p className="text-cream/50 text-base">10 questions. Timer per question. Coins on every correct answer.</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-10">
            {SUBJECTS.map((s, i) => {
              const color = SUBJECT_COLORS[s];
              return (
                <button key={s} onClick={() => startQuiz(s)}
                  className="group relative p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-xl text-left animate-slide-up"
                  style={{
                    animationDelay: `${i * 60}ms`,
                    border: `1px solid ${color}30`,
                    background: `linear-gradient(135deg, ${color}08 0%, #060c18 100%)`,
                  }}>
                  <span className="text-4xl block mb-3 group-hover:scale-110 transition-transform duration-300">{SUBJECT_ICONS[s]}</span>
                  <p className="font-bebas text-xl text-cream tracking-wider">{s}</p>
                  <p className="text-xs mt-1" style={{ color: `${color}cc` }}>10 questions</p>
                </button>
              );
            })}
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
      coinReward: q.coin_reward,
      explanation: q.explanation ?? undefined,
    };

    return (
      <div className="min-h-screen bg-navy pt-20">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{SUBJECT_ICONS[subject]}</span>
              <div>
                <p className="font-bebas text-xl text-cream tracking-wider">{subject}</p>
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
              <span className="text-green-400 font-bold">{quizState.correct} ✓</span>
              <span className="text-red-400 font-bold">{quizState.wrong} ✗</span>
              <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/30 rounded-full px-3 py-1">
                <span>🪙</span>
                <span className="font-bebas text-lg text-gold">{quizState.totalCoins}</span>
              </div>
            </div>
          </div>

          <QuizCard
            key={q.id}
            question={questionForCard}
            questionNumber={currentIndex + 1}
            totalQuestions={questions.length}
            timeLimit={20}
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
          <p className="text-cream/50 text-base mb-8">{subject} Quiz Complete</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              { icon: "✅", label: "Correct", value: quizState.correct, color: "text-green-400" },
              { icon: "❌", label: "Wrong",   value: quizState.wrong,   color: "text-red-400" },
              { icon: "🪙", label: "Coins",   value: quizState.totalCoins, color: "text-gold" },
              { icon: "⚡", label: "XP",      value: quizState.xpEarned, color: "text-electric" },
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
                  {a.correct ? "✓" : "✗"}
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
            <button onClick={restartQuiz} className="btn-outline flex-1 py-3">🔄 New Quiz</button>
            <Link href="/duel" className="flex-1"><button className="btn-primary w-full py-3">⚔️ Duel</button></Link>
            <Link href="/dashboard" className="flex-1"><button className="btn-gold w-full py-3">🏠 Dashboard</button></Link>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
