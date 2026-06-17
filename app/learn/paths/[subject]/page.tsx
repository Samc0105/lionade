"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import {
  getLearningPaths,
  getUserStageProgress,
  getQuizQuestions,
  checkAnswer,
  type LearningPathStage,
  type UserStageProgress,
} from "@/lib/db";
import { apiPost } from "@/lib/api-client";
import { mutateUserStats } from "@/lib/hooks";
import { cdnUrl } from "@/lib/cdn";
import { Ruler, Dna, Bank, Flask, Check, Lock, Lightning, Tray, Compass, type Icon } from "@phosphor-icons/react";

/* ── Subject config ───────────────────────────────────────── */

const SUBJECT_META: Record<
  string,
  { label: string; icon: Icon; color: string; quizSubject: string; quizTopic?: string }
> = {
  algebra: { label: "Algebra", icon: Ruler, color: "#3B82F6", quizSubject: "Math", quizTopic: "algebra" },
  biology: { label: "Biology", icon: Dna, color: "#22C55E", quizSubject: "Science", quizTopic: "biology" },
  us_history: { label: "US History", icon: Bank, color: "#EAB308", quizSubject: "History" },
  chemistry: { label: "Chemistry", icon: Flask, color: "#A855F7", quizSubject: "Science", quizTopic: "chemistry" },
};

/* ── Types ─────────────────────────────────────────────────── */

type StageStatus = "locked" | "available" | "completed";

interface StageWithStatus extends LearningPathStage {
  status: StageStatus;
  stars: number;
  bestScore: number;
  totalQuestions: number;
}

interface QuizQuestion {
  id: string;
  subject: string;
  question: string;
  options: string[];
  difficulty: string;
}

/* ── Page ──────────────────────────────────────────────────── */

export default function RoadMapPage() {
  const router = useRouter();
  const params = useParams();
  const subject = params.subject as string;
  const { user } = useAuth();
  const { stats } = useUserStats(user?.id);
  const meta = SUBJECT_META[subject];

  const [stages, setStages] = useState<StageWithStatus[] | null>(null);
  const [activeStage, setActiveStage] = useState<StageWithStatus | null>(null);
  const [phase, setPhase] = useState<"map" | "lesson" | "quiz" | "results">("map");

  // Quiz state
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [showingFeedback, setShowingFeedback] = useState(false);
  const [resultStars, setResultStars] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [fangsAwarded, setFangsAwarded] = useState<number | null>(null);
  const [xpEarned, setXpEarned] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [timer, setTimer] = useState(30);

  /* ── Fetch stages + progress ────────────────────────────── */

  const loadData = useCallback(async () => {
    if (!user || !subject) return;
    try {
      const [pathStages, userProgress] = await Promise.all([
        getLearningPaths(subject),
        getUserStageProgress(user.id, subject),
      ]);

      const progressMap = new Map<string, UserStageProgress>();
      for (const p of userProgress) {
        progressMap.set(p.stage_id, p);
      }

      // Build stage statuses
      const withStatus: StageWithStatus[] = pathStages.map((stage, i) => {
        const prog = progressMap.get(stage.id);
        const isCompleted = prog?.completed ?? false;

        // A stage is available if it's the first, or the previous stage is completed
        let status: StageStatus = "locked";
        if (i === 0) {
          status = isCompleted ? "completed" : "available";
        } else {
          const prevStage = pathStages[i - 1];
          const prevProg = progressMap.get(prevStage.id);
          const prevCompleted = prevProg?.completed ?? false;
          if (isCompleted) status = "completed";
          else if (prevCompleted) status = "available";
        }

        return {
          ...stage,
          status,
          stars: prog?.stars ?? 0,
          bestScore: prog?.best_score ?? 0,
          totalQuestions: prog?.total_questions ?? 0,
        };
      });

      setStages(withStatus);
    } catch {
      setStages([]);
    }
  }, [user, subject]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ── Timer ──────────────────────────────────────────────── */

  useEffect(() => {
    if (phase !== "quiz" || showingFeedback || timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [phase, showingFeedback, timer]);

  // Auto-submit on timeout
  useEffect(() => {
    if (timer === 0 && phase === "quiz" && !showingFeedback) {
      handleAnswer(-1); // timeout
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);

  /* ── Start a stage ──────────────────────────────────────── */

  async function startStage(stage: StageWithStatus) {
    if (stage.status === "locked") return;
    setActiveStage(stage);
    setPhase("lesson");
  }

  async function startQuiz() {
    if (!activeStage || !meta) return;
    setQuizLoading(true);
    try {
      // Map difficulty based on stage position
      const totalStages = activeStage.total_stages;
      const pos = activeStage.stage_number / totalStages;
      const difficulty = pos <= 0.33 ? "easy" : pos <= 0.66 ? "medium" : "hard";

      const qs = await getQuizQuestions(
        meta.quizSubject as import("@/types").Subject,
        difficulty,
        meta.quizTopic
      );

      if (qs.length === 0) {
        // Fallback: try without topic filter
        const fallback = await getQuizQuestions(
          meta.quizSubject as import("@/types").Subject,
          difficulty
        );
        setQuestions(fallback.slice(0, 5));
      } else {
        setQuestions(qs.slice(0, 5));
      }

      setCurrentQ(0);
      setScore(0);
      setSelectedAnswer(null);
      setIsCorrect(null);
      setExplanation(null);
      setShowingFeedback(false);
      setTimer(30);
      setPhase("quiz");
    } catch {
      // If no questions found, show empty state
      setQuestions([]);
      setPhase("quiz");
    } finally {
      setQuizLoading(false);
    }
  }

  /* ── Answer handling ────────────────────────────────────── */

  async function handleAnswer(answerIdx: number) {
    if (showingFeedback || !questions[currentQ]) return;
    setSelectedAnswer(answerIdx);
    setShowingFeedback(true);

    try {
      const result = await checkAnswer(questions[currentQ].id);
      const correct = answerIdx === result.correct_answer;
      setIsCorrect(correct);
      setExplanation(result.explanation);
      if (correct) setScore((s) => s + 1);
    } catch {
      setIsCorrect(false);
      setExplanation(null);
    }
  }

  function nextQuestion() {
    if (currentQ < questions.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedAnswer(null);
      setIsCorrect(null);
      setExplanation(null);
      setShowingFeedback(false);
      setTimer(30);
    } else {
      finishQuiz();
    }
  }

  async function finishQuiz() {
    if (!activeStage || !user) return;
    setSaveError(null);
    setFangsAwarded(null);
    setXpEarned(null);
    setPhase("results");

    const totalQ = questions.length;
    try {
      // Server-authoritative progress + Fang reward (2026-06-11). The route
      // writes user_stage_progress AND pays the capped reward exactly once
      // per stage completion — the old flow credited coins from the browser
      // (saveStageProgress + saveQuizSession's incrementCoins), which let any
      // client grant itself arbitrary Fangs.
      const res = await apiPost<{
        stars: number;
        isNewBest: boolean;
        fangsAwarded: number;
        xpEarned: number;
      }>("/api/paths/complete-stage", {
        stageId: activeStage.id,
        correct: score,
        total: totalQ,
      });
      if (!res.ok || !res.data) throw new Error(res.error ?? "Couldn't save progress");
      const { stars, isNewBest: newBest, fangsAwarded: awarded, xpEarned: xp } = res.data;
      setResultStars(stars);
      setIsNewBest(newBest);
      // Server is authoritative for both rewards — render exactly what the
      // route paid out rather than recomputing them client-side.
      setFangsAwarded(awarded);
      setXpEarned(xp);

      // The quiz-session log, XP grant, and daily-activity/streak update are now
      // done SERVER-SIDE inside /api/paths/complete-stage (Phase 2 of migration
      // 078 — those profiles columns are guarded against client writes). The old
      // client-side saveQuizSession call is gone.
      mutateUserStats(user.id);
    } catch (err) {
      // Surface the failure on the results screen and suppress reward chips for
      // this unsaved run — showing a 0-star "result" as if it counted is a lie.
      setResultStars(0);
      setIsNewBest(false);
      setFangsAwarded(null);
      setXpEarned(null);
      setSaveError(
        err instanceof Error && err.message ? err.message : "Couldn't save your progress"
      );
    }
  }

  function backToMap() {
    setPhase("map");
    setActiveStage(null);
    setQuestions([]);
    loadData(); // Refresh progress
  }

  /* ── Render helpers ─────────────────────────────────────── */

  if (!meta) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-20 flex items-center justify-center">
          <div className="text-center px-4">
            <div className="mb-4 flex justify-center" aria-hidden="true">
              <Compass size={48} weight="regular" color="#FFD700" />
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70 mb-2">
              unknown subject
            </p>
            <h1 className="font-bebas text-3xl text-cream tracking-[0.08em] leading-none mb-3">
              SUBJECT NOT FOUND
            </h1>
            <p className="text-cream/45 text-sm font-syne max-w-xs mx-auto mb-6 leading-relaxed">
              That path doesn&apos;t exist yet. Head back and pick another subject.
            </p>
            <button
              onClick={() => router.push("/learn/paths")}
              className="btn-primary px-6 py-2.5 font-syne font-semibold"
            >
              Back to Subjects
            </button>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  const completedCount = stages?.filter((s) => s.status === "completed").length ?? 0;
  const totalCount = stages?.length ?? 0;
  const totalStars = stages?.reduce((sum, s) => sum + s.stars, 0) ?? 0;

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* ── MAP PHASE ──────────────────────────────────── */}
          {phase === "map" && (
            <>
              <BackButton />

              {/* Header */}
              <div className="text-center mb-6 animate-slide-up">
                <span
                  className="mb-3 inline-flex w-16 h-16 items-center justify-center rounded-2xl"
                  style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35` }}
                >
                  {(() => { const IconComp = meta.icon; return <IconComp size={36} weight="regular" aria-hidden="true" color="currentColor" />; })()}
                </span>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] mb-2" style={{ color: `${meta.color}AA` }}>
                  subject path
                </p>
                <h1
                  className="font-bebas text-5xl sm:text-6xl tracking-[0.08em] leading-none"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </h1>
                {totalCount > 0 && (
                  <div className="mt-4 inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em]">
                    <span className="text-cream/55">
                      <span className="text-cream/85 tabular-nums">{completedCount}</span>
                      <span className="text-cream/35">/</span>
                      <span className="text-cream/85 tabular-nums">{totalCount}</span>
                      <span className="ml-1.5 text-cream/40">stages cleared</span>
                    </span>
                    {totalStars > 0 && (
                      <>
                        <span className="text-cream/20">/</span>
                        <span className="inline-flex items-center gap-1.5 text-gold/85">
                          <span className="tabular-nums">{totalStars}</span>
                          <span className="text-gold/55">stars</span>
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Progress bar */}
              <div
                className="mb-8 animate-slide-up"
                style={{ animationDelay: "0.05s" }}
              >
                <div
                  className="w-full h-2.5 rounded-full overflow-hidden"
                  style={{
                    background: "var(--progress-track)",
                    border: "1px solid var(--progress-track-border)",
                  }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                      background:
                        totalCount > 0 && completedCount === totalCount
                          ? `linear-gradient(90deg, ${meta.color}, #FFD700)`
                          : `linear-gradient(90deg, ${meta.color}80, ${meta.color})`,
                    }}
                  />
                </div>
              </div>

              {/* Road map */}
              {stages === null ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-20 rounded-2xl animate-pulse"
                      style={{ background: "var(--card-solid-bg)" }}
                    />
                  ))}
                </div>
              ) : (
                <div className="relative">
                  {/* Vertical line */}
                  <div
                    className="absolute left-7 top-4 bottom-4 w-0.5"
                    style={{ background: `${meta.color}20` }}
                  />

                  <div className="space-y-3">
                    {stages.map((stage, i) => (
                      <button
                        key={stage.id}
                        onClick={() => startStage(stage)}
                        disabled={stage.status === "locked"}
                        className={`relative w-full flex items-center gap-4 p-4 rounded-2xl border text-left
                          transition-all duration-300 animate-slide-up
                          ${stage.status === "locked"
                            ? "opacity-40 cursor-not-allowed"
                            : "hover:-translate-y-0.5 cursor-pointer"
                          }
                          ${stage.status === "available" ? "idle-pulse" : ""}`}
                        style={{
                          animationDelay: `${0.08 + i * 0.04}s`,
                          background: "var(--card-solid-bg)",
                          borderColor:
                            stage.status === "completed"
                              ? `${meta.color}50`
                              : stage.status === "available"
                              ? "#FFD70060"
                              : "var(--card-solid-border)",
                          boxShadow:
                            stage.status === "available"
                              ? `0 0 20px #FFD70015`
                              : stage.status === "completed"
                              ? `0 0 15px ${meta.color}10`
                              : "none",
                        }}
                      >
                        {/* Node circle */}
                        <div
                          className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
                            text-sm font-bold border-2 transition-all"
                          style={{
                            borderColor:
                              stage.status === "completed"
                                ? meta.color
                                : stage.status === "available"
                                ? "#FFD700"
                                : "var(--card-solid-border)",
                            background:
                              stage.status === "completed"
                                ? `${meta.color}30`
                                : stage.status === "available"
                                ? "#FFD70015"
                                : "var(--card-solid-bg)",
                            color:
                              stage.status === "completed"
                                ? meta.color
                                : stage.status === "available"
                                ? "#FFD700"
                                : "var(--text-secondary, rgba(255,255,255,0.3))",
                          }}
                        >
                          {stage.status === "completed" ? (
                            <span className="text-lg">
                              <Check size={20} weight="regular" aria-hidden="true" color="currentColor" />
                            </span>
                          ) : stage.status === "locked" ? (
                            <span className="text-base">
                              <Lock size={18} weight="regular" aria-hidden="true" color="currentColor" />
                            </span>
                          ) : (
                            stage.stage_number
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p
                            className="font-mono text-[9px] uppercase tracking-[0.25em] mb-0.5"
                            style={{
                              color:
                                stage.status === "completed"
                                  ? `${meta.color}AA`
                                  : stage.status === "available"
                                  ? "#FFD700AA"
                                  : "rgba(255,255,255,0.25)",
                            }}
                          >
                            stage {stage.stage_number}
                          </p>
                          <p
                            className="font-bebas text-lg sm:text-xl tracking-[0.06em] truncate leading-tight"
                            style={{
                              color:
                                stage.status === "completed"
                                  ? meta.color
                                  : stage.status === "available"
                                  ? "#EEF4FF"
                                  : "rgba(255,255,255,0.3)",
                            }}
                          >
                            {stage.stage_name}
                          </p>
                          <p className="text-cream/35 text-xs font-syne truncate mt-0.5">
                            {stage.stage_description}
                          </p>
                        </div>

                        {/* Stars or status */}
                        <div className="flex-shrink-0 text-right">
                          {stage.status === "completed" && stage.stars > 0 ? (
                            <div className="flex gap-0.5" aria-label={`${stage.stars} of 3 stars`}>
                              {[1, 2, 3].map((s) => (
                                <span
                                  key={s}
                                  className="text-lg leading-none"
                                  style={{
                                    color: s <= stage.stars ? "#FFD700" : "rgba(255,255,255,0.15)",
                                    filter: s <= stage.stars ? "drop-shadow(0 0 4px #FFD70035)" : "none",
                                  }}
                                >
                                  ★
                                </span>
                              ))}
                            </div>
                          ) : stage.status === "available" ? (
                            <span
                              className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] px-2.5 py-1 rounded-full"
                              style={{
                                background: "#FFD70020",
                                color: "#FFD700",
                                border: "1px solid #FFD70040",
                              }}
                            >
                              start
                              <span aria-hidden="true">&rarr;</span>
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── LESSON PHASE ───────────────────────────────── */}
          {phase === "lesson" && activeStage && (
            <div className="animate-slide-up">
              <button
                onClick={backToMap}
                className="group inline-flex items-center gap-2 text-cream/45 hover:text-cream/80 font-mono text-[10px] uppercase tracking-[0.25em] transition-colors mb-6"
              >
                <span className="text-sm leading-none -translate-x-0 group-hover:-translate-x-0.5 transition-transform duration-200" aria-hidden="true">&larr;</span>
                <span>back to map</span>
              </button>

              <div className="text-center mb-8">
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.3em] mb-2"
                  style={{ color: `${meta.color}AA` }}
                >
                  stage <span className="tabular-nums">{activeStage.stage_number}</span>
                  <span className="text-cream/30"> / </span>
                  <span className="tabular-nums">{activeStage.total_stages}</span>
                </p>
                <h1
                  className="font-bebas text-4xl sm:text-5xl tracking-[0.08em] leading-none"
                  style={{ color: meta.color }}
                >
                  {activeStage.stage_name}
                </h1>
                <p className="text-cream/45 text-sm font-syne mt-3 max-w-md mx-auto leading-relaxed">
                  {activeStage.stage_description}
                </p>
              </div>

              {/* Lesson card */}
              <div
                className="rounded-2xl p-6 sm:p-8 mb-6"
                style={{
                  background: "var(--card-solid-bg)",
                  border: `1px solid ${meta.color}30`,
                  boxShadow: `0 0 24px ${meta.color}10`,
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <p className="font-bebas text-base tracking-[0.2em] leading-none" style={{ color: meta.color }}>
                    LESSON
                  </p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/40">
                    read &middot; then quiz
                  </p>
                </div>
                <p className="text-cream/75 text-sm sm:text-base leading-relaxed font-syne">
                  {activeStage.lesson_text || activeStage.stage_description}
                </p>
              </div>

              {/* Best score if replaying */}
              {activeStage.bestScore > 0 && (
                <div className="mb-5 flex justify-center">
                  <div
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
                    style={{
                      background: "rgba(255,215,0,0.06)",
                      border: "1px solid rgba(255,215,0,0.18)",
                    }}
                  >
                    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-gold/70">
                      personal best
                    </span>
                    <span className="font-bebas text-sm text-cream tabular-nums tracking-wider">
                      {activeStage.bestScore}<span className="text-cream/35">/</span>{activeStage.totalQuestions}
                    </span>
                    <span className="text-sm leading-none">
                      <span style={{ color: "#FFD700" }}>{"★".repeat(activeStage.stars)}</span>
                      <span className="text-cream/15">{"★".repeat(3 - activeStage.stars)}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Start quiz button */}
              <div className="text-center">
                <button
                  onClick={startQuiz}
                  disabled={quizLoading}
                  className="btn-gold px-8 py-3 text-lg font-bebas tracking-[0.12em]"
                >
                  {quizLoading
                    ? "Loading..."
                    : activeStage.status === "completed"
                    ? "Replay for Better Stars"
                    : "Start Quiz"}
                </button>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40 mt-4">
                  <span className="text-cream/65 tabular-nums">5</span> questions
                  <span className="mx-2 text-cream/20">/</span>
                  <span className="text-cream/65 tabular-nums">30s</span> each
                  <span className="mx-2 text-cream/20">/</span>
                  earn up to <span className="text-gold/80 tabular-nums">3</span> stars
                </p>
              </div>
            </div>
          )}

          {/* ── QUIZ PHASE ─────────────────────────────────── */}
          {phase === "quiz" && (
            <div className="animate-slide-up">
              {questions.length === 0 ? (
                <div className="text-center py-16">
                  <div className="mb-4 flex justify-center" aria-hidden="true">
                    <Tray size={48} weight="regular" color={meta.color} />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70 mb-2">
                    no questions yet
                  </p>
                  <h2 className="font-bebas text-3xl text-cream tracking-[0.08em] leading-none mb-3">
                    THIS STAGE IS COMING SOON
                  </h2>
                  <p className="text-cream/45 text-sm font-syne max-w-sm mx-auto mb-6 leading-relaxed">
                    We&apos;re still loading questions for this stage. Try another stage in the meantime.
                  </p>
                  <button onClick={backToMap} className="btn-primary px-6 py-2.5 font-syne font-semibold">
                    Back to Map
                  </button>
                </div>
              ) : (
                <>
                  {/* Quiz header */}
                  <div className="flex items-center justify-between mb-6">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
                      question
                      <span className="ml-1.5 text-cream/85 tabular-nums">{currentQ + 1}</span>
                      <span className="text-cream/30">/</span>
                      <span className="text-cream/85 tabular-nums">{questions.length}</span>
                    </p>
                    <div className="flex items-center gap-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
                        score
                        <span className="ml-1.5 font-bebas text-base text-cream tabular-nums tracking-wider">{score}</span>
                      </p>
                      <div
                        role="timer"
                        aria-label={`${timer} ${timer === 1 ? "second" : "seconds"} left`}
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bebas text-lg border-2 tabular-nums"
                        style={{
                          borderColor: timer <= 10 ? "#EF4444" : `${meta.color}60`,
                          color: timer <= 10 ? "#EF4444" : meta.color,
                          boxShadow: timer <= 10 ? "0 0 12px rgba(239,68,68,0.35)" : "none",
                        }}
                      >
                        {timer}
                      </div>
                    </div>
                  </div>

                  {/* Progress dots */}
                  <div className="flex gap-1.5 mb-6">
                    {questions.map((_, i) => (
                      <div
                        key={i}
                        className="h-1.5 flex-1 rounded-full transition-all duration-300"
                        style={{
                          background:
                            i < currentQ
                              ? meta.color
                              : i === currentQ
                              ? `${meta.color}80`
                              : "var(--progress-track)",
                        }}
                      />
                    ))}
                  </div>

                  {/* Question */}
                  <div
                    className="rounded-2xl p-6 mb-6"
                    style={{
                      background: "var(--card-solid-bg)",
                      border: "1px solid var(--card-solid-border)",
                    }}
                  >
                    <p className="text-cream text-base sm:text-lg font-syne leading-relaxed">
                      {questions[currentQ].question}
                    </p>
                  </div>

                  {/* Answer options */}
                  <div className="space-y-3 mb-6">
                    {questions[currentQ].options.map((opt, idx) => {
                      let borderColor = "var(--card-solid-border)";
                      let bg = "var(--card-solid-bg)";

                      if (showingFeedback && selectedAnswer === idx) {
                        borderColor = isCorrect ? "#22C55E" : "#EF4444";
                        bg = isCorrect
                          ? "rgba(34,197,94,0.1)"
                          : "rgba(239,68,68,0.1)";
                      }

                      return (
                        <button
                          key={idx}
                          onClick={() => handleAnswer(idx)}
                          disabled={showingFeedback}
                          className={`w-full text-left p-4 rounded-xl border transition-all duration-200
                            ${!showingFeedback ? "hover:-translate-y-0.5 hover:bg-white/5 cursor-pointer" : ""}
                            ${showingFeedback ? "cursor-default" : ""}`}
                          style={{ borderColor, background: bg }}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className="w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5"
                              style={{ borderColor }}
                            >
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <p className="text-cream text-sm sm:text-base font-syne">
                              {opt}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Feedback */}
                  {showingFeedback && (
                    <div className="animate-slide-up">
                      <div
                        className="rounded-xl p-4 mb-4 border"
                        style={{
                          background: isCorrect
                            ? "rgba(34,197,94,0.08)"
                            : "rgba(239,68,68,0.08)",
                          borderColor: isCorrect
                            ? "rgba(34,197,94,0.3)"
                            : "rgba(239,68,68,0.3)",
                        }}
                      >
                        <p
                          className="font-bebas text-lg tracking-wider"
                          style={{ color: isCorrect ? "#22C55E" : "#EF4444" }}
                        >
                          {isCorrect ? "Correct!" : selectedAnswer === -1 ? "Time\u2019s up!" : "Incorrect"}
                        </p>
                        {explanation && (
                          <p className="text-cream/50 text-sm font-syne mt-1">
                            {explanation}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={nextQuestion}
                        className="w-full btn-primary py-3 font-bebas text-lg tracking-wider"
                      >
                        {currentQ < questions.length - 1 ? "Next Question" : "See Results"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── RESULTS PHASE ──────────────────────────────── */}
          {phase === "results" && activeStage && (
            <div className="animate-slide-up text-center py-8" role="status">
              {/* Stars display */}
              <div className="flex justify-center gap-3 mb-6">
                {[1, 2, 3].map((s) => (
                  <span
                    key={s}
                    className="text-5xl transition-all duration-500"
                    style={{
                      color: s <= resultStars ? "#FFD700" : "rgba(255,255,255,0.1)",
                      filter: s <= resultStars ? "drop-shadow(0 0 10px #FFD70040)" : "none",
                      animationDelay: `${s * 0.15}s`,
                    }}
                  >
                    ★
                  </span>
                ))}
              </div>

              <p
                className="font-mono text-[10px] uppercase tracking-[0.3em] mb-2"
                style={{ color: `${meta.color}AA` }}
              >
                stage results
              </p>

              <h2
                className="font-bebas text-4xl tracking-[0.08em] mb-3 leading-none"
                style={{ color: meta.color }}
              >
                {resultStars >= 3
                  ? "PERFECT!"
                  : resultStars >= 2
                  ? "GREAT JOB!"
                  : resultStars >= 1
                  ? "STAGE COMPLETE!"
                  : "KEEP TRYING!"}
              </h2>

              <p className="text-cream/50 text-sm font-syne mb-4">
                {activeStage.stage_name}
              </p>

              <p className="text-cream font-bebas text-3xl tabular-nums tracking-wider mb-1 leading-none">
                {score}<span className="text-cream/35">/</span>{questions.length}
              </p>
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/40 mt-1 mb-6">
                correct answers
              </p>

              {isNewBest && (
                <div className="mb-4 flex justify-center">
                  <span
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] px-3 py-1 rounded-full text-gold"
                    style={{
                      background: "rgba(255,215,0,0.1)",
                      border: "1px solid rgba(255,215,0,0.3)",
                    }}
                  >
                    <span aria-hidden="true">★</span> new personal best
                  </span>
                </div>
              )}

              {/* Save failure — this run did not count. Suppress the reward
                  chips so we never imply Fangs/XP were granted for an unsaved
                  attempt, and let the user retry. */}
              {saveError ? (
                <div
                  className="mb-8 mx-auto max-w-sm rounded-2xl border border-red-400/30 bg-red-400/5 p-5 text-center"
                  role="alert"
                >
                  <p className="font-bebas text-lg tracking-wider text-red-300 mb-1">
                    Couldn&apos;t save this run
                  </p>
                  <p className="text-cream/55 text-sm font-syne leading-relaxed">
                    Your progress and rewards weren&apos;t recorded. Check your connection and try the stage again.
                  </p>
                </div>
              ) : (
                /* Rewards */
                <div
                  className="inline-flex items-center gap-6 px-6 py-3 rounded-2xl mb-8"
                  style={{
                    background: "var(--card-solid-bg)",
                    border: "1px solid var(--card-solid-border)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    {/* Server-authoritative Fang payout from /api/paths/complete-stage. */}
                    <span className="font-bebas text-xl text-gold">
                      +{fangsAwarded ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg text-electric">
                      <Lightning size={20} weight="regular" aria-hidden="true" color="currentColor" />
                    </span>
                    {/* Server-authoritative XP payout from /api/paths/complete-stage. */}
                    <span className="font-bebas text-xl text-electric">
                      +{xpEarned ?? 0} XP
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {resultStars < 3 && (
                  <button
                    onClick={() => {
                      setPhase("lesson");
                    }}
                    className="btn-outline px-6 py-2.5 font-syne font-semibold"
                  >
                    Retry for More Stars
                  </button>
                )}
                <button
                  onClick={backToMap}
                  className="btn-primary px-6 py-2.5 font-syne font-semibold"
                >
                  Back to Map
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
