"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { getQuizHistory } from "@/lib/db";

const AP_TOPICS = [
  { name: "AP Biology", slug: "ap-biology", icon: "\u{1F9EC}", color: "#22C55E" },
  { name: "AP Chemistry", slug: "ap-chemistry", icon: "\u2697\uFE0F", color: "#A855F7" },
  { name: "AP US History", slug: "ap-us-history", icon: "\u{1F3DB}\uFE0F", color: "#EAB308" },
  { name: "AP World History", slug: "ap-world-history", icon: "\u{1F30D}", color: "#3B82F6" },
  { name: "AP Calculus AB", slug: "ap-calculus-ab", icon: "\u{1F4D0}", color: "#EF4444" },
  { name: "AP English Language", slug: "ap-english-language", icon: "\u{1F4D6}", color: "#F97316" },
  { name: "AP Psychology", slug: "ap-psychology", icon: "\u{1F9E0}", color: "#EC4899" },
  { name: "AP Macroeconomics", slug: "ap-macroeconomics", icon: "\u{1F4C8}", color: "#14B8A6" },
  { name: "AP Physics", slug: "ap-physics", icon: "\u26A1", color: "#6366F1" },
  { name: "AP Statistics", slug: "ap-statistics", icon: "\u{1F4CA}", color: "#8B5CF6" },
];

interface QuizHistoryEntry {
  id: string;
  subject: string;
  total_questions: number;
  correct_answers: number;
  coins_earned: number;
  completed_at: string;
}

export default function ApExamsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);

  useEffect(() => {
    if (!user) return;
    getQuizHistory(user.id, 200).then(setQuizHistory).catch(() => {});
  }, [user]);

  const getBestScore = (topicName: string): { correct: number; total: number } | null => {
    const matching = quizHistory.filter(
      (h) => h.subject === "Test Prep"
    );
    if (matching.length === 0) return null;
    const best = matching.reduce((a, b) =>
      b.correct_answers / b.total_questions > a.correct_answers / a.total_questions ? b : a
    );
    return { correct: best.correct_answers, total: best.total_questions };
  };

  const startApQuiz = (topicName: string) => {
    // Navigate to quiz with subject and topic as query params
    router.push(`/quiz?subject=Test+Prep&topic=${encodeURIComponent(topicName)}`);
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackButton />

          {/* Header */}
          <div className="flex items-center gap-4 mb-8 animate-slide-up">
            <span className="text-5xl">{"\u{1F4DD}"}</span>
            <div>
              <h1 className="font-bebas text-4xl sm:text-5xl tracking-wider" style={{ color: "#EC4899" }}>
                AP EXAMS
              </h1>
              <p className="text-cream/40 text-sm font-syne">10 AP subjects available</p>
            </div>
          </div>

          {/* Topic grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {AP_TOPICS.map((ap, i) => {
              const best = getBestScore(ap.name);
              const accuracy = best ? Math.round((best.correct / best.total) * 100) : 0;

              return (
                <button
                  key={ap.slug}
                  onClick={() => startApQuiz(ap.name)}
                  className="quiz-subject-card group relative p-5 rounded-2xl border transition-all duration-200
                    hover:-translate-y-1 text-left animate-slide-up cursor-pointer"
                  style={{
                    animationDelay: `${i * 0.05}s`,
                    border: `1px solid ${ap.color}30`,
                    background: `linear-gradient(135deg, ${ap.color}08 0%, #060c18 100%)`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = `0 0 25px ${ap.color}20, 0 8px 32px ${ap.color}10`;
                    e.currentTarget.style.borderColor = `${ap.color}60`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.borderColor = `${ap.color}30`;
                  }}
                >
                  <span className="text-3xl block mb-3 group-hover:scale-110 transition-transform duration-300">
                    {ap.icon}
                  </span>
                  <p className="card-title font-bebas text-xl text-cream tracking-wider mb-1">{ap.name}</p>
                  <span
                    className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mb-3"
                    style={{ background: `${ap.color}15`, border: `1px solid ${ap.color}30`, color: `${ap.color}cc` }}
                  >
                    Test Prep
                  </span>
                  <div className="pt-3 border-t border-white/5">
                    {best ? (
                      <>
                        <p className="text-cream/50 text-[11px]">
                          Best: <span className="font-bold text-cream/70">{best.correct}/{best.total}</span>
                        </p>
                        <div className="w-full h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${accuracy}%`, background: ap.color }}
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
      </div>
    </ProtectedRoute>
  );
}
