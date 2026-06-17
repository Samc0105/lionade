"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Subject } from "@/types";
import { SUBJECT_ICONS, SUBJECT_COLORS, DefaultSubjectIcon, formatCoins } from "@/lib/mockData";
import { getQuizQuestions, checkAnswer, getSubjectStats, getQuizHistory } from "@/lib/db";
import QuizCard from "@/components/QuizCard";
import { useAuth } from "@/lib/auth";
import RevealText from "@/components/RevealText";
import { mutateUserStats } from "@/lib/hooks";
import { invalidateAfter } from "@/lib/cache-invalidation";
import { mutate as swrMutate } from "swr";
import MissionsBetFloat from "@/components/Quiz/MissionsBetFloat";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";
import { cdnUrl } from "@/lib/cdn";
import { SITE_HOST } from "@/lib/site-config";
import { apiGet, apiPost, apiPatch } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import { useHeartbeat } from "@/lib/use-heartbeat";
import Confetti from "@/components/Confetti";
import CelebrationOverlay, { type Celebration } from "@/components/CelebrationOverlay";
import {
  Calculator,
  TestTube,
  Globe,
  BookOpen,
  Code,
  Cloud,
  CurrencyDollar,
  NotePencil,
  Lightning,
  Check,
  X as XIcon,
  Share,
  Lightbulb,
  ChartBar,
  Target,
  Star,
  Coin,
  Coins,
  Clock,
  Leaf,
  Snowflake,
  TrendUp,
  Rocket,
  Circle,
  Fire,
  type Icon,
} from "@phosphor-icons/react";

function isLightMode() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("light");
}

interface Topic {
  name: string;
  subject: Subject;
}

interface Category {
  id: string;
  name: string;
  Icon: Icon;
  color: string;
  topics: Topic[];
}

const CATEGORIES: Category[] = [
  {
    id: "math", name: "Math", Icon: Calculator, color: "#EF4444",
    topics: [
      { name: "Algebra", subject: "Math" as Subject },
      { name: "Geometry", subject: "Math" as Subject },
      { name: "Calculus", subject: "Math" as Subject },
      { name: "Statistics", subject: "Math" as Subject },
      { name: "Trigonometry", subject: "Math" as Subject },
    ],
  },
  {
    id: "science", name: "Science", Icon: TestTube, color: "#22C55E",
    topics: [
      { name: "Biology", subject: "Science" as Subject },
      { name: "Chemistry", subject: "Science" as Subject },
      { name: "Physics", subject: "Science" as Subject },
      { name: "Earth Science", subject: "Science" as Subject },
      { name: "Astronomy", subject: "Science" as Subject },
    ],
  },
  {
    id: "languages", name: "Languages", Icon: Globe, color: "#3B82F6",
    topics: [
      { name: "Spanish", subject: "Languages" as Subject },
      { name: "French", subject: "Languages" as Subject },
      { name: "German", subject: "Languages" as Subject },
      { name: "English Grammar", subject: "Languages" as Subject },
    ],
  },
  {
    id: "humanities", name: "Humanities", Icon: BookOpen, color: "#A855F7",
    topics: [
      { name: "World History", subject: "Humanities" as Subject },
      { name: "US History", subject: "Humanities" as Subject },
      { name: "Geography", subject: "Humanities" as Subject },
      { name: "Philosophy", subject: "Humanities" as Subject },
    ],
  },
  {
    id: "tech", name: "Tech & Coding", Icon: Code, color: "#6B7280",
    topics: [
      { name: "Python", subject: "Tech & Coding" as Subject },
      { name: "JavaScript", subject: "Tech & Coding" as Subject },
      { name: "Data Structures", subject: "Tech & Coding" as Subject },
      { name: "Web Development", subject: "Tech & Coding" as Subject },
      { name: "SQL & Databases", subject: "Tech & Coding" as Subject },
    ],
  },
  {
    id: "cloud", name: "Cloud & IT", Icon: Cloud, color: "#F97316",
    topics: [
      { name: "AWS", subject: "Cloud & IT" as Subject },
      { name: "Azure", subject: "Cloud & IT" as Subject },
      { name: "CompTIA", subject: "Cloud & IT" as Subject },
      { name: "Networking", subject: "Cloud & IT" as Subject },
      { name: "Cybersecurity", subject: "Cloud & IT" as Subject },
    ],
  },
  {
    id: "finance", name: "Finance & Business", Icon: CurrencyDollar, color: "#EAB308",
    topics: [
      { name: "Personal Finance", subject: "Finance & Business" as Subject },
      { name: "Investing", subject: "Finance & Business" as Subject },
      { name: "Accounting", subject: "Finance & Business" as Subject },
      { name: "Economics", subject: "Finance & Business" as Subject },
      { name: "Entrepreneurship", subject: "Finance & Business" as Subject },
    ],
  },
  {
    id: "testprep", name: "Test Prep", Icon: NotePencil, color: "#EC4899",
    topics: [
      { name: "SAT Reading", subject: "Test Prep" as Subject },
      { name: "SAT Math", subject: "Test Prep" as Subject },
      { name: "ACT Science", subject: "Test Prep" as Subject },
      { name: "ACT English", subject: "Test Prep" as Subject },
      { name: "AP Exams", subject: "Test Prep" as Subject },
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

/** Animated counting number — counts from 0 to `end` over `duration` ms */
function useCountUp(end: number, duration: number, delay: number = 0) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (end === 0) { setValue(0); return; }
    const timeout = setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic for satisfying deceleration
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * end));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [end, duration, delay]);
  return value;
}

/** Gold coin particles that burst outward */
function CoinBurst({ count }: { count: number }) {
  const particles = useMemo(() => {
    if (count === 0) return [];
    const total = Math.min(count * 3, 24);
    return Array.from({ length: total }, (_, i) => {
      const angle = (i / total) * 360 + (Math.random() * 30 - 15);
      const distance = 60 + Math.random() * 80;
      const size = 6 + Math.random() * 10;
      const delay = Math.random() * 0.3;
      const dx = Math.cos((angle * Math.PI) / 180) * distance;
      const dy = Math.sin((angle * Math.PI) / 180) * distance;
      return { dx, dy, size, delay, id: i };
    });
  }, [count]);

  if (count === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute left-1/2 top-1/2 rounded-full coin-burst-particle"
          style={{
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            background: `radial-gradient(circle, #FFD700, #B8860B)`,
            boxShadow: "0 0 6px #FFD70080",
            // @ts-expect-error CSS custom properties
            "--burst-x": `${p.dx}px`,
            "--burst-y": `${p.dy}px`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function QuizPage() {
  const { user, isLoading, refreshUser } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("select");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [totalCoins, setTotalCoins] = useState(0);
  const [totalXp, setTotalXp] = useState(0);

  const [blitzMode, setBlitzMode] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [subjectStats, setSubjectStats] = useState<SubjectStatEntry[]>([]);
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);
  // Flash-of-zero guard (CLAUDE.md non-negotiable): Quick Stats render "—"
  // placeholders until the stats/history fetches settle (success OR failure),
  // so veterans never see "Quizzes 0 / 0%" flash on mount.
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Anti-cheat: result comes back from server after user selects
  const [currentResult, setCurrentResult] = useState<{ correctIndex: number; explanation: string | null } | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMistakes, setShowMistakes] = useState(false);
  const [bonusFangs, setBonusFangs] = useState(0);
  const [streakMilestone, setStreakMilestone] = useState<{ days: number; bonus: number } | null>(null);

  // Boosters
  interface ActiveBooster { id: string; item_id: string; booster_effect: string; booster_value: number; uses_remaining: number }
  const [activeBoosters, setActiveBoosters] = useState<ActiveBooster[]>([]);
  const [fiftyFiftyUsed, setFiftyFiftyUsed] = useState(false);
  const [autoCorrectUsed, setAutoCorrectUsed] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);

  // Tier 3 — refresh-resumable state. We persist the in-flight quiz to
  // /api/quiz/state (jsonb in quiz_session_state) and offer a tiny banner
  // on mount if a previous unfinished quiz exists. The shape includes the
  // questions[] array so a resume doesn't refetch (saves a DB round-trip
  // and avoids the "new questions" feel on reload). State is cleared
  // automatically on finishQuiz + on explicit "Start fresh".
  const [resumePrompt, setResumePrompt] = useState<null | {
    subject: Subject; activeTopic: string | null; difficulty: Difficulty;
    blitzMode: boolean; questions: QuizQuestion[]; currentIndex: number;
    answers: AnswerRecord[];
  }>(null);
  const stateHydratedRef = useRef(false);
  const stateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Heartbeat — fires only during the quiz phase. We use the user-id as the
  // "session id" because quiz sessions aren't keyed by a row id; the
  // active_session pointer is set elsewhere on quiz start (Phase 1).
  useHeartbeat(phase === "quiz" && user?.id ? "quiz" : null, user?.id ?? null);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  // Hydrate resume state on mount. One-shot. If a quiz is in-flight we
  // show a banner offering Resume / Start fresh. We DON'T auto-resume
  // because the user may have intentionally bailed.
  useEffect(() => {
    if (!user || stateHydratedRef.current) return;
    stateHydratedRef.current = true;
    (async () => {
      type StateResp = {
        state: {
          subject?: Subject; activeTopic?: string | null; difficulty?: Difficulty;
          blitzMode?: boolean; questions?: QuizQuestion[]; currentIndex?: number;
          answers?: AnswerRecord[];
        } | null;
      };
      const r = await apiGet<StateResp>("/api/quiz/state?game_type=quiz");
      if (r.ok && r.data?.state?.questions && r.data.state.questions.length > 0
          && typeof r.data.state.currentIndex === "number"
          && r.data.state.currentIndex < r.data.state.questions.length
          && r.data.state.subject) {
        setResumePrompt({
          subject: r.data.state.subject,
          activeTopic: r.data.state.activeTopic ?? null,
          difficulty: r.data.state.difficulty ?? "medium",
          blitzMode: !!r.data.state.blitzMode,
          questions: r.data.state.questions,
          currentIndex: r.data.state.currentIndex,
          answers: r.data.state.answers ?? [],
        });
      }
    })();
  }, [user]);

  // Debounced autosave on every meaningful change during a live quiz.
  // 500ms debounce matches the spec; we DON'T save while in "select" or
  // "results" since those phases would either clobber the resume row or
  // duplicate the clear-on-finish.
  useEffect(() => {
    if (phase !== "quiz" || !subject) return;
    if (stateSaveTimerRef.current) clearTimeout(stateSaveTimerRef.current);
    stateSaveTimerRef.current = setTimeout(() => {
      void apiPost("/api/quiz/state", {
        game_type: "quiz",
        state: {
          subject,
          activeTopic,
          difficulty,
          blitzMode,
          questions,
          currentIndex,
          answers,
        },
      });
    }, 500);
    return () => {
      if (stateSaveTimerRef.current) clearTimeout(stateSaveTimerRef.current);
    };
  }, [phase, subject, activeTopic, difficulty, blitzMode, questions, currentIndex, answers]);

  useEffect(() => {
    if (!user) return;
    // allSettled keeps the old swallow-errors behavior while guaranteeing
    // statsLoaded flips even when a fetch fails (no permanent "—" lock-up
    // logic needed — failure just means we show whatever did load).
    void Promise.allSettled([
      getSubjectStats(user.id).then(setSubjectStats),
      getQuizHistory(user.id, 100).then(setQuizHistory),
    ]).then(() => setStatsLoaded(true));
  }, [user]);

  // Auto-start from query params (e.g. /quiz?subject=Test+Prep&topic=AP+Biology)
  useEffect(() => {
    if (autoStarted || !user || phase !== "select") return;
    const params = new URLSearchParams(window.location.search);
    const qSubject = params.get("subject");
    const qTopic = params.get("topic");
    if (qSubject && qTopic) {
      setAutoStarted(true);
      startQuiz(qSubject as Subject, qTopic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, phase]);

  const diffMult = DIFFICULTY_MULTIPLIER[difficulty];
  const blitzMult = blitzMode ? 2 : 1;

  // Booster helpers
  const hasBooster = (effect: string) => activeBoosters.some((b) => b.booster_effect === effect);
  const getBoosterValue = (effect: string) => activeBoosters.find((b) => b.booster_effect === effect)?.booster_value ?? 0;
  // Double Down (coin_xp_multiplier) applies to BOTH coins and XP, so it
  // feeds whichever multiplier isn't already set by Coin Rush / XP Surge.
  const coinMultiplier =
    hasBooster("coin_multiplier") ? getBoosterValue("coin_multiplier")
    : hasBooster("coin_xp_multiplier") ? getBoosterValue("coin_xp_multiplier")
    : 1;
  const xpMultiplier =
    hasBooster("xp_multiplier") ? getBoosterValue("xp_multiplier")
    : hasBooster("coin_xp_multiplier") ? getBoosterValue("coin_xp_multiplier")
    : 1;
  const extraTime = hasBooster("extra_time") ? getBoosterValue("extra_time") : 0;
  const hasAutoCorrect = hasBooster("auto_correct") && !autoCorrectUsed;
  const hasFiftyFifty = hasBooster("fifty_fifty") && !fiftyFiftyUsed;
  const scoreBoost = hasBooster("score_boost") ? getBoosterValue("score_boost") : 0;

  const BOOSTER_ICONS: Record<string, Icon> = {
    coin_multiplier: Coins, xp_multiplier: Lightning, extra_time: Clock,
    auto_correct: Leaf, fifty_fifty: Snowflake, score_boost: TrendUp,
  };

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
    const correctCount = Math.min(finalAnswers.filter((a) => a.correct).length + scoreBoost, questions.length);
    let coins = finalAnswers.reduce((sum, a) => sum + (a.correct ? Math.round(1 * diffMult * blitzMult * coinMultiplier) : 0), 0);
    const xp = finalAnswers.reduce((sum, a) => sum + (a.correct ? Math.round(10 * diffMult * blitzMult * xpMultiplier) : 0), 0);

    if (correctCount === questions.length && questions.length === 10) {
      coins += 5;
    }

    for (const booster of activeBoosters) {
      await apiPatch("/api/shop/activate-booster", { boosterId: booster.id });
    }

    setTotalCoins(coins);
    setTotalXp(xp);

    // Stable idempotency key for this attempt — a network retry of this submit
    // reuses it so the server dedups instead of double-crediting.
    const attemptId = crypto.randomUUID();
    const res = await apiPost<{ success: boolean; bonusFangs?: number }>(
      "/api/save-quiz-results",
      {
        attemptId,
        subject: subject!,
        totalQuestions: questions.length,
        correctAnswers: correctCount,
        coinsEarned: coins,
        xpEarned: xp,
        // Server reads body.blitzMode for the blitz_score bounty — without
        // this the bounty can never complete from web (iOS already sends it).
        blitzMode,
        answers: finalAnswers.map((a) => ({
          questionId: a.questionId,
          selected: a.selected,
          isCorrect: a.correct,
          timeLeft: a.timeLeft,
        })),
      },
    );

    if (res.ok && res.data?.success) {
      await refreshUser();
      if (user?.id) {
        mutateUserStats(user.id);
        // Cascading cache invalidation 2026-05-14 — mirrors iOS pattern.
        // Refresh every cache key the quiz could have stale'd: recent
        // quizzes, weekly activity, subject stats, missions, bounties,
        // wallet, badges. Same action map as iOS — see
        // @lionade/core/cache/invalidate.ts.
        void invalidateAfter("quizCompleted", user.id);
      }
      setBonusFangs(res.data.bonusFangs ?? 0);
      setStreakMilestone((res.data as { streakMilestone?: { days: number; bonus: number } | null }).streakMilestone ?? null);
    }

    // Clear refresh-resume state — the quiz is done. Fire-and-forget;
    // re-saves elsewhere are gated by phase === "quiz" so they won't
    // resurrect the row after this.
    void apiPost("/api/quiz/state", { game_type: "quiz", state: null });

    setPhase("results");
  }

  const startQuiz = async (s: Subject, topicName?: string) => {
    setSubject(s);
    setActiveTopic(topicName ?? null);
    setPhase("loading");
    try {
      // Fetch active boosters
      const boosterRes = await apiGet<{ boosters: ActiveBooster[] }>("/api/shop/activate-booster");
      if (boosterRes.ok && boosterRes.data?.boosters) {
        setActiveBoosters(boosterRes.data.boosters);
      }
      setFiftyFiftyUsed(false);
      setAutoCorrectUsed(false);

      const qs = await getQuizQuestions(s, difficulty, topicName);
      if (qs.length === 0) {
        toastError("No questions available for this subject and difficulty yet. Try another.");
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
      // A failed question fetch must never strand the user on a blank quiz —
      // surface the failure and drop cleanly back to subject selection.
      toastError("Could not load questions. Check your connection and try again.");
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
        let isCorrect = answerIndex === correct_answer;

        // Auto-correct: first question auto-correct if booster active
        if (!isCorrect && hasAutoCorrect && currentIndex === 0) {
          isCorrect = true;
          setAutoCorrectUsed(true);
        }

        // Calculate rewards (with booster multipliers)
        const coinReward = isCorrect ? Math.round(1 * diffMult * blitzMult * coinMultiplier) : 0;
        const xpReward = isCorrect ? Math.round(10 * diffMult * blitzMult * xpMultiplier) : 0;

        const newAnswer: AnswerRecord = { questionId: q.id, selected: answerIndex, correct: isCorrect, timeLeft, questionText: q.question, options: q.options, correctIndex: correct_answer, explanation };
        const updatedAnswers = [...answers, newAnswer];
        setAnswers(updatedAnswers);
        setTotalCoins((prev) => prev + coinReward);
        setTotalXp((prev) => prev + xpReward);
        setCurrentResult({ correctIndex: correct_answer, explanation });

        // Live-update the MissionsBetFloat (shared SWR cache with Dashboard).
        // SWR's 5s dedupe debounces the network spam if the user answers
        // fast — this is fire-and-forget; we never await the revalidation.
        if (user?.id) {
          void swrMutate(`dashboard-missions/${user.id}`);
          void swrMutate(`dashboard-active-bet/${user.id}`);
        }

        // Auto-advance after delay
        const delay = explanation ? 3000 : 1400;
        advanceTimerRef.current = setTimeout(() => {
          advanceAfterAnswer(updatedAnswers);
        }, delay);
      } catch (err) {
        console.error("Failed to check answer", err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIndex, questions, answers, diffMult, blitzMult, coinMultiplier, xpMultiplier, hasAutoCorrect, user?.id]
  );

  // Early return AFTER all hooks and function definitions
  if (isLoading || !user) return null;

  const restartQuiz = () => {
    setPhase("select");
    setSubject(null);
    setActiveTopic(null);
    setQuestions([]);
    setCurrentIndex(0);
    setAnswers([]);
    setTotalCoins(0);
    setTotalXp(0);
    setCurrentResult(null);
    setShowMistakes(false);
    setBonusFangs(0);
  };

  const correctCount = answers.filter((a) => a.correct).length;
  const wrongCount = answers.filter((a) => !a.correct).length;
  const accuracy = answers.length > 0 ? Math.round((correctCount / answers.length) * 100) : 0;

  const getStatForSubject = (s: Subject) => subjectStats.find((st) => st.subject === s);

  const recommendations: { category: Category; topic: Topic; reason: string }[] = [];
  for (const cat of CATEGORIES) {
    if (recommendations.length >= 2) break;
    for (const topic of cat.topics) {
      if (recommendations.length >= 2) break;
      const stat = getStatForSubject(topic.subject);
      if (!stat) {
        recommendations.push({ category: cat, topic, reason: `New territory. Start with ${topic.name}.` });
        break;
      } else if (stat.questionsAnswered > 0) {
        const acc = Math.round((stat.correctAnswers / stat.questionsAnswered) * 100);
        if (acc < 60) {
          recommendations.push({ category: cat, topic, reason: `${topic.subject} accuracy ${acc}%. Sharpen on ${topic.name}.` });
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

  const timerLimit = (blitzMode ? 10 : 15) + extraTime;

  // Coin reward display for current question
  const currentCoinReward = Math.round(1 * diffMult * blitzMult * coinMultiplier);

  // ── Select ────────────────────────────────────────────────
  if (phase === "select") {
    const activeCategory = CATEGORIES.find((c) => c.id === expandedCategory);

    return (
      <div className="min-h-screen pt-20">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <BackButton />
          {resumePrompt && (
            <div className="mb-6 rounded-2xl border border-electric/40 bg-electric/[0.06] px-4 py-3 flex items-center gap-3 animate-slide-up">
              <Lightning size={14} weight="fill" className="text-electric shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-cream leading-tight">
                  Resume your {resumePrompt.subject} quiz
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
                  Question {resumePrompt.currentIndex + 1} of {resumePrompt.questions.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const rp = resumePrompt;
                  setResumePrompt(null);
                  setSubject(rp.subject);
                  setActiveTopic(rp.activeTopic);
                  setDifficulty(rp.difficulty);
                  setBlitzMode(rp.blitzMode);
                  setQuestions(rp.questions);
                  setCurrentIndex(rp.currentIndex);
                  setAnswers(rp.answers);
                  setPhase("quiz");
                }}
                className="font-mono text-[11px] uppercase tracking-[0.25em] text-navy bg-electric rounded-full px-3 py-1.5"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  setResumePrompt(null);
                  void apiPost("/api/quiz/state", { game_type: "quiz", state: null });
                }}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55 hover:text-cream"
              >
                Start fresh
              </button>
            </div>
          )}
          <div className="text-center mb-8 animate-slide-up">
            <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-electric/80 mb-4">
              <Lightning size={12} weight="fill" aria-hidden="true" className="inline mr-2 -mt-0.5" />
              Earn your Fangs
            </p>
            <h1 className="font-bebas text-6xl sm:text-7xl text-cream tracking-wider mb-4 leading-[0.95]">
              PICK YOUR<br /><span className="shimmer-text">BATTLEFIELD</span>
            </h1>
            <p className="text-cream/55 text-base max-w-md mx-auto">
              Ten questions. Timer per question. Fangs on every correct answer.
            </p>
          </div>

          {/* ── Blitz Mode Card ── */}
          <div className="animate-slide-up mb-6" style={{ animationDelay: "0.05s" }}>
            <button
              type="button"
              onClick={() => setBlitzMode(!blitzMode)}
              aria-pressed={blitzMode}
              aria-label="Blitz mode: 2x Fangs and XP with a shorter 10 second timer"
              className={`quiz-blitz-card w-full p-4 rounded-2xl border transition-all duration-300 text-left flex items-center gap-4 cursor-pointer${blitzMode ? " blitz-active" : ""}`}
              style={{
                background: blitzMode
                  ? "linear-gradient(135deg, #EAB30820 0%, #FFD70010 100%)"
                  : "linear-gradient(135deg, #EAB30808 0%, #060c18 100%)",
                borderColor: blitzMode ? "#EAB30860" : "#EAB30825",
                boxShadow: blitzMode ? "0 0 30px #EAB30820, 0 0 60px #EAB30810" : "none",
              }}
            >
              <Lightning size={32} weight="fill" color="#EAB308" aria-hidden="true" />
              <div className="flex-1">
                <p className="font-bebas text-xl text-[#EAB308] tracking-wider">BLITZ MODE</p>
                <p className="blitz-subtitle text-cream/60 text-xs font-syne">2x Fangs & XP, Shorter Timer (10s)</p>
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
                { d: "easy" as Difficulty, label: "Beginner", color: "#22C55E", desc: "Fundamentals and basics", mult: "1x" },
                { d: "medium" as Difficulty, label: "Intermediate", color: "#EAB308", desc: "Deeper concepts and application", mult: "1.5x" },
                { d: "hard" as Difficulty, label: "Advanced", color: "#EF4444", desc: "Expert-level challenges", mult: "2x" },
              ]).map(({ d, label, color, desc, mult }) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(d)}
                  aria-pressed={difficulty === d}
                  aria-label={`${label} difficulty, ${mult} Fangs. ${desc}`}
                  className={`quiz-diff-card relative p-4 rounded-2xl border-2 transition-all duration-300 text-left cursor-pointer hover:-translate-y-0.5${difficulty === d ? ` diff-selected diff-${d === "easy" ? "green" : d === "medium" ? "yellow" : "red"}` : ""}`}
                  style={{
                    background: difficulty === d
                      ? `linear-gradient(135deg, ${color}15 0%, ${color}05 100%)`
                      : "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
                    borderColor: difficulty === d ? color : "#ffffff10",
                    boxShadow: difficulty === d ? `0 0 20px ${color}30, 0 0 40px ${color}10` : "none",
                  }}
                >
                  <Circle size={28} weight="fill" color={color} className="mb-2" aria-hidden="true" />
                  <p className="diff-label font-bebas text-lg tracking-wider" style={{ color: difficulty === d ? color : "#ffffff60" }}>{label}</p>
                  <p className="diff-desc text-cream/60 text-[11px] leading-tight mt-1">{desc}</p>
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
                      onClick={() => startQuiz(rec.topic.subject, rec.topic.name)}
                      className="quiz-subject-card flex items-center gap-3 p-4 rounded-2xl border text-left transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
                      style={{ background: `linear-gradient(135deg, ${color}10 0%, #060c18 100%)`, borderColor: `${color}30` }}
                      onMouseEnter={(e) => {
                        if (isLightMode()) {
                          e.currentTarget.style.borderColor = color;
                          e.currentTarget.style.boxShadow = `0 0 16px ${color}33`;
                        } else {
                          e.currentTarget.style.boxShadow = `0 0 20px ${color}20`;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (isLightMode()) {
                          e.currentTarget.style.borderColor = "#e5e7eb";
                          e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
                        } else {
                          e.currentTarget.style.boxShadow = "none";
                        }
                      }}
                    >
                      <rec.category.Icon size={32} weight="regular" color={rec.category.color} aria-hidden="true" />
                      <div>
                        <p className="card-title font-bebas text-lg tracking-wider" style={{ color }}>{rec.topic.name}</p>
                        <p className="card-subtitle text-cream/60 text-xs font-syne">{rec.reason}</p>
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
                  className="quiz-subject-card group relative p-5 rounded-2xl border transition-all duration-200 hover:-translate-y-1 text-left animate-slide-up cursor-pointer"
                  style={{
                    animationDelay: `${0.12 + i * 0.04}s`,
                    border: `1px solid ${cat.color}30`,
                    background: `linear-gradient(135deg, ${cat.color}08 0%, #060c18 100%)`,
                  }}
                  onMouseEnter={(e) => {
                    if (isLightMode()) {
                      e.currentTarget.style.borderColor = cat.color;
                      e.currentTarget.style.boxShadow = `0 0 16px ${cat.color}33`;
                    } else {
                      e.currentTarget.style.boxShadow = `0 0 25px ${cat.color}20, 0 8px 32px ${cat.color}10`;
                      e.currentTarget.style.borderColor = `${cat.color}60`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isLightMode()) {
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
                    } else {
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.borderColor = `${cat.color}30`;
                    }
                  }}
                >
                  <cat.Icon size={40} weight="regular" color={cat.color} className="mb-3 group-hover:scale-110 transition-transform duration-300" aria-hidden="true" />
                  <p className="card-title font-bebas text-xl text-cream tracking-wider">{cat.name}</p>
                  <p className="card-subtitle text-xs mt-1" style={{ color: `${cat.color}cc` }}>{cat.topics.length} topics</p>
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
                <activeCategory.Icon size={52} weight="regular" color={activeCategory.color} aria-hidden="true" />
                <div>
                  <h2 className="font-bebas text-3xl tracking-wider" style={{ color: activeCategory.color }}>{activeCategory.name}</h2>
                  <p className="text-cream/60 text-sm font-syne">{activeCategory.topics.length} topics available</p>
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
                      onClick={() => {
                        if (topic.name === "AP Exams") { router.push("/quiz/ap-exams"); return; }
                        startQuiz(topic.subject, topic.name);
                      }}
                      className="quiz-subject-card group relative p-5 rounded-2xl border transition-all duration-200 hover:-translate-y-1 text-left animate-slide-up cursor-pointer"
                      style={{ animationDelay: `${i * 0.05}s`, border: `1px solid ${color}30`, background: `linear-gradient(135deg, ${color}08 0%, #060c18 100%)` }}
                      onMouseEnter={(e) => {
                        if (isLightMode()) {
                          e.currentTarget.style.borderColor = color;
                          e.currentTarget.style.boxShadow = `0 0 16px ${color}33`;
                        } else {
                          e.currentTarget.style.boxShadow = `0 0 25px ${color}20, 0 8px 32px ${color}10`;
                          e.currentTarget.style.borderColor = `${color}60`;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (isLightMode()) {
                          e.currentTarget.style.borderColor = "#e5e7eb";
                          e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
                        } else {
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.borderColor = `${color}30`;
                        }
                      }}
                    >
                      <p className="card-title font-bebas text-xl text-cream tracking-wider mb-1">{topic.name}</p>
                      <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mb-3"
                        style={{ background: `${color}15`, border: `1px solid ${color}30`, color: `${color}cc` }}>{topic.subject}</span>
                      <div className="pt-3 border-t border-white/5">
                        {bestScore ? (
                          <>
                            <p className="text-cream/55 text-[11px]">Best: <span className="font-bold text-cream/70">{bestScore.correct}/{bestScore.total}</span></p>
                            <div className="w-full h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${subjectAccuracy}%`, background: color }} />
                            </div>
                          </>
                        ) : (
                          <p className="text-cream/55 text-[11px]">Not attempted yet</p>
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
                // value === null → "—" placeholder (stats not loaded yet, or no data).
                { label: "Quizzes", value: statsLoaded ? totalQuizzes.toString() : null, Icon: ChartBar, color: "#4A90D9" },
                // No data isn't 0% accuracy — a fresh account shows "—" instead of a punitive 0%.
                { label: "Avg Accuracy", value: statsLoaded && totalQuizzes > 0 ? `${avgAccuracy}%` : null, Icon: Target, color: "#22C55E" },
                { label: "Favorite", value: statsLoaded ? favoriteSubject : null, Icon: Star, color: "#A855F7" },
                { label: "Fangs Earned", value: statsLoaded ? formatCoins(totalCoinsEarned) : null, Icon: Coin, color: "#FFD700" },
              ].map((stat) => {
                const StatIcon = stat.Icon;
                return (
                  <div key={stat.label} className="quiz-stat-card p-4 rounded-2xl border text-center"
                    style={{ background: `linear-gradient(135deg, ${stat.color}08 0%, #060c18 100%)`, borderColor: `${stat.color}20` }}>
                    <StatIcon size={28} weight="fill" color={stat.color} className="mx-auto mb-1" aria-hidden="true" />
                    <p className={`font-bebas text-2xl leading-none ${stat.value === null ? "text-cream/30" : ""}`}
                      style={stat.value === null ? undefined : { color: stat.color }}>{stat.value ?? "—"}</p>
                    <p className="stat-label text-cream/60 text-[10px] uppercase tracking-wider mt-1">{stat.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────
  // A real skeleton of the quiz card (not a bare spinner) so the transition
  // into the question feels continuous and never flashes a blank/broken card.
  if (phase === "loading") {
    return (
      <div className="min-h-screen pt-20" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading questions</span>
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Header row skeleton */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-md bg-white/10 animate-pulse" aria-hidden="true" />
              <div>
                <div className="h-5 w-28 rounded bg-white/10 animate-pulse mb-2" aria-hidden="true" />
                <div className="flex gap-1">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="h-1.5 w-2 rounded-full bg-white/10 animate-pulse" aria-hidden="true" />
                  ))}
                </div>
              </div>
            </div>
            <div className="h-7 w-20 rounded-full bg-white/10 animate-pulse" aria-hidden="true" />
          </div>

          {/* Card skeleton */}
          <div className="w-full max-w-2xl mx-auto">
            <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden mb-6 animate-pulse" aria-hidden="true" />
            <div className="flex justify-center mb-6">
              <div
                className="w-14 h-14 rounded-full border-2 border-electric/70 border-t-transparent animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            </div>
            <div
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6"
              aria-hidden="true"
            >
              <div className="h-3 w-24 rounded bg-white/10 animate-pulse motion-reduce:animate-none mx-auto mb-4" />
              <div className="h-5 w-3/4 rounded bg-white/10 animate-pulse motion-reduce:animate-none mx-auto mb-2" />
              <div className="h-5 w-1/2 rounded bg-white/10 animate-pulse motion-reduce:animate-none mx-auto" />
            </div>
            <div className="grid grid-cols-1 gap-3" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl border border-white/10 bg-white/[0.03] animate-pulse motion-reduce:animate-none"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
            <p className="font-bebas text-lg text-electric/80 tracking-[0.22em] text-center mt-6">
              LOADING QUESTIONS
            </p>
          </div>
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
              {(() => {
                const QuizSubjectIcon = SUBJECT_ICONS[subject] ?? DefaultSubjectIcon;
                return <QuizSubjectIcon size={24} weight="regular" color={subjectColor} aria-hidden="true" />;
              })()}
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bebas text-xl text-cream tracking-wider">{subject}</p>
                  {blitzMode && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#EAB308]/20 border border-[#EAB308]/40 text-[#EAB308]">
                      <Lightning size={11} weight="fill" aria-hidden="true" className="inline mr-1 -mt-px" /> Blitz
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-1" role="img" aria-label={`Question ${currentIndex + 1} of ${questions.length}`}>
                  {questions.map((_, i) => (
                    <div key={i} aria-hidden="true" className="h-1.5 rounded-full transition-all duration-300"
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
            <div className="flex items-center gap-3 text-sm" role="status" aria-live="polite">
              {/* Active booster icons */}
              {activeBoosters.length > 0 && (
                <div className="flex items-center gap-1" aria-label="Active boosters">
                  {activeBoosters.map((b) => {
                    const BoosterIcon = BOOSTER_ICONS[b.booster_effect] ?? Rocket;
                    const boosterLabel = b.booster_effect.replace(/_/g, " ");
                    return (
                      <span key={b.id} className="w-7 h-7 rounded-lg flex items-center justify-center text-sm booster-active" title={boosterLabel} aria-label={`Active booster: ${boosterLabel}`}
                        style={{ background: "rgba(74,144,217,0.1)", border: "1px solid rgba(74,144,217,0.3)" }}>
                        <BoosterIcon size={16} weight="fill" aria-hidden="true" />
                      </span>
                    );
                  })}
                </div>
              )}
              <span className="text-green-400 font-bold inline-flex items-center gap-1" aria-label={`${correctCount} correct`}>{correctCount} <Check size={14} weight="bold" aria-hidden="true" /></span>
              <span className="text-red-400 font-bold inline-flex items-center gap-1" aria-label={`${wrongCount} wrong`}>{wrongCount} <XIcon size={14} weight="bold" aria-hidden="true" /></span>
              <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/30 rounded-full px-3 py-1" aria-label={`${totalCoins} Fangs earned this quiz`}>
                <img src={cdnUrl("/F.png")} alt="" aria-hidden="true" className="w-5 h-5 object-contain" />
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

        {/* Floating Today's Missions + Daily Bet pill. Mounted only during
            the answering phase so it stays out of the way on select/results. */}
        <MissionsBetFloat />
      </div>
    );
  }

  // ── Results ───────────────────────────────────────────────
  if (phase === "results") {
    return <ResultsScreen
      answers={answers}
      totalCoins={totalCoins}
      totalXp={totalXp}
      accuracy={accuracy}
      correctCount={correctCount}
      wrongCount={wrongCount}
      subject={subject}
      blitzMode={blitzMode}
      showMistakes={showMistakes}
      setShowMistakes={setShowMistakes}
      router={router}
      bonusFangs={bonusFangs}
      streakMilestone={streakMilestone}
    />;
  }


  return null;
}

/* ═══════════════════════════════════════════════════════════════
   Results Screen — with animated counters + coin burst
   ═══════════════════════════════════════════════════════════════ */

function ResultsScreen({
  answers, totalCoins, totalXp, accuracy, correctCount, wrongCount,
  subject, blitzMode, showMistakes, setShowMistakes, router, bonusFangs,
  streakMilestone,
}: {
  answers: AnswerRecord[];
  totalCoins: number;
  totalXp: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  subject: Subject | null;
  blitzMode: boolean;
  showMistakes: boolean;
  setShowMistakes: (v: boolean) => void;
  router: ReturnType<typeof useRouter>;
  bonusFangs: number;
  streakMilestone: { days: number; bonus: number } | null;
}) {
  const getRank = (acc: number) => {
    if (acc === 100) return { label: "PERFECT",       icon: "\u{1F48E}", color: "#FFD700", illustration: "rank-perfect" };
    if (acc >= 80)  return { label: "ELITE",          icon: "\u{1F525}", color: "#4A90D9", illustration: "rank-elite" };
    if (acc >= 60)  return { label: "SOLID",          icon: "\u{1F44D}", color: "#2ECC71", illustration: "rank-solid" };
    return            { label: "KEEP GRINDING",       icon: "\u{1F4AA}", color: "#E67E22", illustration: "rank-keep-grinding" };
  };

  const rank = getRank(accuracy);
  const mistakes = answers.filter((a) => !a.correct);

  // Animated counters — staggered delays for dramatic reveal
  const animCoins = useCountUp(totalCoins, 1200, 600);
  const animXp = useCountUp(totalXp, 1200, 800);
  const animCorrect = useCountUp(correctCount, 800, 400);
  const animWrong = useCountUp(wrongCount, 800, 500);
  const animAccuracy = useCountUp(accuracy, 1000, 1000);

  // Coin burst triggers after a short delay
  const [showBurst, setShowBurst] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowBurst(true), 500);
    return () => clearTimeout(t);
  }, []);

  // Glow pulse on coins card when count finishes
  const [coinGlow, setCoinGlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCoinGlow(true), 1800);
    return () => clearTimeout(t);
  }, []);

  // Earned-moment overlay queue. Built once on first mount from the
  // results-screen props so a remount (or state change) doesn't replay it.
  const celebrationsRef = useRef<Celebration[] | null>(null);
  if (celebrationsRef.current === null) {
    const list: Celebration[] = [];
    if (streakMilestone) {
      const tier =
        streakMilestone.days >= 100 ? "streak-100-day" :
        streakMilestone.days >= 30  ? "streak-30-day"  :
                                      "streak-7-day";
      list.push({
        id: `streak-${streakMilestone.days}`,
        eyebrow: "STREAK MILESTONE",
        headline: `${streakMilestone.days} DAYS STRONG`,
        description: "Consistency is compounding. Keep showing up.",
        illustration: cdnUrl(`/illustrations/${tier}.png`),
        fangs: streakMilestone.bonus,
        accent: "ember",
      });
    }
    if (bonusFangs > 0) {
      list.push({
        id: "consecutive-3",
        eyebrow: "BONUS UNLOCKED",
        headline: "3 IN A ROW",
        description: "Three quizzes in an hour. The grind is paying out.",
        illustration: cdnUrl("/illustrations/rank-elite.png"),
        fangs: bonusFangs,
        accent: "gold",
      });
    }
    if (accuracy === 100) {
      list.push({
        id: "perfect-run",
        eyebrow: "PERFECT RUN",
        headline: "FLAWLESS",
        description: "Every answer correct. That deserves a moment.",
        illustration: cdnUrl("/illustrations/rank-perfect.png"),
        accent: "electric",
      });
    }
    celebrationsRef.current = list;
  }
  const [overlayDone, setOverlayDone] = useState(false);

  return (
    <div className="min-h-screen pt-20 relative overflow-hidden">
      {/* Peak earned-moment overlay — fires once on mount, queues multiple
          celebrations, then settles into the inline summaries below. */}
      {!overlayDone && celebrationsRef.current && celebrationsRef.current.length > 0 && (
        <CelebrationOverlay
          celebrations={celebrationsRef.current}
          onAllDismissed={() => setOverlayDone(true)}
        />
      )}

      {/* Celebration confetti for strong results — ELITE (80%+) or PERFECT (100%) */}
      <Confetti trigger={accuracy >= 80} count={accuracy === 100 ? 80 : 50} duration={accuracy === 100 ? 1800 : 1400} />

      {/* Radial glow behind the score, tinted by performance tier */}
      <div
        className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${rank.color}14 0%, transparent 60%)` }}
        aria-hidden="true"
      />

      <div className="max-w-4xl mx-auto px-4 py-12 relative z-10">
        {/* Rank header — illustration + label, centered above the debrief */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4 animate-slide-up">
            <img
              src={cdnUrl(`/illustrations/${rank.illustration}.png`)}
              alt=""
              width={120}
              height={120}
              className="w-28 h-28 object-contain"
              aria-hidden="true"
            />
          </div>
          <h1
            className="font-bebas text-6xl tracking-wider mb-2 animate-slide-up"
            style={{ animationDelay: "0.05s", color: rank.color, textShadow: `0 0 32px ${rank.color}40` }}
          >
            {rank.label}
          </h1>
          <p className="text-cream/60 text-base animate-slide-up" style={{ animationDelay: "0.08s" }}>
            {subject} Quiz Complete
            {blitzMode && <span className="text-[#EAB308] ml-2 inline-flex items-center gap-1"><Lightning size={14} weight="fill" aria-hidden="true" /> Blitz</span>}
          </p>
        </div>

        {/* Streak milestone banner — uses tier illustration matching the streak length */}
        {streakMilestone && (() => {
          const tier =
            streakMilestone.days >= 100 ? "streak-100-day" :
            streakMilestone.days >= 30  ? "streak-30-day"  :
                                          "streak-7-day";
          return (
          <div
            className="flex items-center justify-center gap-3 rounded-2xl px-5 py-4 mb-4 animate-slide-up"
            style={{
              animationDelay: "0.08s",
              background: "linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(255,215,0,0.10) 100%)",
              border: "1px solid rgba(249,115,22,0.45)",
              boxShadow: "0 0 40px rgba(249,115,22,0.20)",
            }}
          >
            <img
              src={cdnUrl(`/illustrations/${tier}.png`)}
              alt=""
              width={44}
              height={44}
              className="w-11 h-11 object-contain flex-shrink-0"
              aria-hidden="true"
            />
            <div className="text-left">
              <p className="font-bebas text-xl text-[#F97316] tracking-wider leading-none">
                <RevealText
                  text={`${streakMilestone.days}-DAY STREAK!`}
                  color="#F97316"
                  glow="0 0 8px rgba(249,115,22,0.5)"
                  delay={0.18}
                  charDelay={0.04}
                />
              </p>
              <p className="text-cream/55 text-xs mt-0.5">
                Milestone bonus added to your wallet
              </p>
            </div>
            <span className="font-bebas text-2xl text-[#FFD700] ml-auto">
              +{streakMilestone.bonus} <Coin size={20} weight="fill" color="#FFD700" aria-hidden="true" className="inline ml-0.5 -mt-0.5" />
            </span>
          </div>
          );
        })()}

        {/* Consecutive quiz bonus banner */}
        {bonusFangs > 0 && (
          <div
            className="flex items-center justify-center gap-3 rounded-2xl px-5 py-4 mb-4 animate-slide-up"
            style={{
              animationDelay: "0.10s",
              background: "linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(255,165,0,0.08) 100%)",
              border: "1px solid rgba(255,215,0,0.35)",
              boxShadow: "0 0 30px rgba(255,215,0,0.12)",
            }}
          >
            <Fire size={28} weight="fill" color="#FFD700" aria-hidden="true" />
            <div className="text-left">
              <p className="font-bebas text-lg text-[#FFD700] tracking-wider leading-none">3 QUIZZES IN A ROW!</p>
              <p className="text-cream/55 text-xs mt-0.5">Bonus +{bonusFangs} fangs added to your wallet</p>
            </div>
            <span className="font-bebas text-2xl text-[#FFD700] ml-auto inline-flex items-center gap-1">+{bonusFangs} <Coin size={20} weight="fill" aria-hidden="true" /></span>
          </div>
        )}

        {/* ═══ 2-COLUMN DEBRIEF ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start text-left">

        {/* ── LEFT: score stat tiles + accuracy + actions ── */}
        <div>
        {/* Glass Stat Cards — with animated counters */}
        <div className="grid grid-cols-2 gap-3 mb-5 animate-slide-up" style={{ animationDelay: "0.12s" }}>
          {[
            { Icon: Check, label: "Correct", value: animCorrect, accent: "#2ECC71", isCoin: false },
            { Icon: XIcon, label: "Wrong", value: animWrong, accent: "#E74C3C", isCoin: false },
            { Icon: Coin, label: "Fangs", value: animCoins, accent: "#FFD700", isCoin: true },
            { Icon: Lightning, label: "XP", value: animXp, accent: "#4A90D9", isCoin: false },
          ].map((s) => {
            const SIcon = s.Icon;
            return (
              <div
                key={s.label}
                className="relative rounded-2xl p-5 text-center backdrop-blur-xl overflow-visible"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${s.isCoin && coinGlow ? "rgba(255,215,0,0.35)" : "rgba(255,255,255,0.10)"}`,
                  boxShadow: s.isCoin && coinGlow
                    ? "0 0 30px rgba(255,215,0,0.15), 0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)"
                    : "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
                  transition: "border-color 0.6s, box-shadow 0.6s",
                }}
              >
                {/* Coin burst particles */}
                {s.isCoin && showBurst && <CoinBurst count={totalCoins} />}

                <SIcon size={28} weight="fill" color={s.accent} className="mx-auto mb-2" aria-hidden="true" />
                <p className="font-bebas text-4xl leading-none" style={{ color: s.accent }}>
                  {s.isCoin ? `+${s.value}` : s.value}
                </p>
                <p className="text-cream/55 text-[11px] uppercase tracking-wider mt-1.5">{s.label}</p>
              </div>
            );
          })}
        </div>

        {/* Glass Answer Breakdown */}
        <div
          className="rounded-2xl p-5 mb-5 text-left backdrop-blur-xl animate-slide-up"
          style={{
            animationDelay: "0.18s",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">ANSWER BREAKDOWN</h2>
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
            <span className="text-cream/60 text-sm">Accuracy</span>
            <span className="font-bebas text-2xl" style={{ color: rank.color }}>{animAccuracy}%</span>
          </div>
          <div className="w-full h-2 bg-white/[0.06] rounded-full mt-2.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${animAccuracy}%`, background: `linear-gradient(90deg, ${rank.color}cc, ${rank.color})` }}
            />
          </div>
        </div>

        {/* Glass Buttons */}
        <div className="flex flex-col gap-3 animate-slide-up" style={{ animationDelay: "0.24s" }}>
          <button
            onClick={() => router.push("/learn")}
            className="flex-1 py-3.5 rounded-xl font-syne font-bold text-sm transition-all duration-200 hover:brightness-125 active:scale-[0.98] backdrop-blur-xl cursor-pointer"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--card-border)",
              color: "var(--text-primary)",
              boxShadow: "var(--card-shadow)",
            }}
          >
            New Quiz
          </button>
          <button
            onClick={() => setShowMistakes(!showMistakes)}
            disabled={mistakes.length === 0}
            className="flex-1 py-3.5 rounded-xl font-syne font-bold text-sm transition-all duration-200 hover:brightness-125 active:scale-[0.98] backdrop-blur-xl cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: mistakes.length > 0 ? "rgba(231,76,60,0.10)" : "var(--bg-card)",
              border: `1px solid ${mistakes.length > 0 ? "rgba(231,76,60,0.25)" : "var(--card-border)"}`,
              color: mistakes.length > 0 ? "#E74C3C" : "var(--text-secondary)",
              boxShadow: "var(--card-shadow)",
            }}
          >
            {showMistakes ? "Hide Mistakes" : `Review Mistakes${mistakes.length > 0 ? ` (${mistakes.length})` : ""}`}
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="flex-1 py-3.5 rounded-xl font-syne font-bold text-sm transition-all duration-200 hover:brightness-125 active:scale-[0.98] backdrop-blur-xl cursor-pointer"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--card-border)",
              color: "var(--text-primary)",
              boxShadow: "var(--card-shadow)",
            }}
          >
            Dashboard
          </button>
        </div>

        {/* Share Results button — Feature 2 */}
        {correctCount > 0 && (
          <div className="mt-3 animate-slide-up" style={{ animationDelay: "0.25s" }}>
            <button
              onClick={async () => {
                const text = [
                  `${rank.icon} ${rank.label}. ${correctCount}/${correctCount + wrongCount} on ${subject ?? "a quiz"}`,
                  `${accuracy}% accuracy | ${totalCoins} Fangs earned`,
                  `Can you beat me? ${SITE_HOST}/demo`,
                ].join("\n");
                try {
                  if (navigator.share) {
                    await navigator.share({ text });
                  } else {
                    await navigator.clipboard.writeText(text);
                    toastSuccess("Copied to clipboard.");
                  }
                } catch { /* user cancelled share sheet */ }
              }}
              className="w-full py-3.5 rounded-xl font-bebas tracking-wider text-sm transition-all duration-200 hover:brightness-125 active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, rgba(74,144,217,0.15) 0%, rgba(74,144,217,0.08) 100%)",
                border: "1px solid rgba(74,144,217,0.35)",
                color: "#4A90D9",
              }}
            >
              <Share size={16} weight="regular" aria-hidden="true" className="inline mr-2 -mt-0.5" /> Share Results
            </button>
          </div>
        )}
        </div>{/* ── end LEFT column ── */}

        {/* ── RIGHT: review mistakes (fills the column) ── */}
        <div className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
          {mistakes.length === 0 ? (
            <div
              className="rounded-2xl p-8 text-center backdrop-blur-xl h-full flex flex-col items-center justify-center"
              style={{
                background: "rgba(46,204,113,0.04)",
                border: "1px solid rgba(46,204,113,0.18)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <Check size={40} weight="bold" color="#2ECC71" aria-hidden="true" className="mb-3" />
              <h2 className="font-bebas text-2xl text-cream tracking-wider mb-1">FLAWLESS RUN</h2>
              <p className="text-cream/55 text-sm leading-relaxed max-w-xs">
                No mistakes to review. Every answer landed. Keep the streak going.
              </p>
            </div>
          ) : (
            <div
              className="rounded-2xl p-5 text-left backdrop-blur-xl"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bebas text-xl text-cream tracking-wider">REVIEW MISTAKES</h2>
                <span className="text-[#E74C3C] text-xs font-bold uppercase tracking-widest">{mistakes.length}</span>
              </div>
              {/* Scrollable box so a long mistake list doesn't stretch the
                  whole results screen — it scrolls inside a fixed max height. */}
              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
              {(showMistakes ? mistakes : mistakes.slice(0, 1)).map((m) => {
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
                  <p className="text-cream/55 text-xs font-bold uppercase tracking-widest mb-2">
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
                      let textColor = "rgba(238,244,255,0.55)";
                      if (isCorrectOpt) { bg = "rgba(46,204,113,0.10)"; border = "rgba(46,204,113,0.30)"; textColor = "#2ECC71"; }
                      else if (isUserPick) { bg = "rgba(231,76,60,0.10)"; border = "rgba(231,76,60,0.30)"; textColor = "#E74C3C"; }
                      return (
                        <div key={oi} className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm"
                          style={{ background: bg, border: `1px solid ${border}`, color: textColor }}>
                          <span className="font-bebas text-base w-6 text-center flex-shrink-0">
                            {isCorrectOpt ? "\u2713" : isUserPick ? "\u2717" : optionLabels[oi]}
                          </span>
                          <span className={isCorrectOpt || isUserPick ? "font-semibold" : ""}>{opt}</span>
                          {isUserPick && !isCorrectOpt && <span className="ml-auto text-[10px] uppercase tracking-widest opacity-60">Your answer</span>}
                          {isCorrectOpt && <span className="ml-auto text-[10px] uppercase tracking-widest opacity-60">Correct</span>}
                        </div>
                      );
                    })}
                  </div>
                  {m.explanation && (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl"
                      style={{ background: "rgba(74,144,217,0.06)", border: "1px solid rgba(74,144,217,0.15)" }}>
                      <Lightbulb size={18} weight="regular" color="#4A90D9" className="flex-shrink-0" aria-hidden="true" />
                      <p className="text-cream/60 text-sm leading-relaxed">{m.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
              </div>
              {mistakes.length > 1 && (
                <button
                  onClick={() => setShowMistakes(!showMistakes)}
                  className="w-full mt-4 py-2.5 rounded-xl font-syne font-bold text-xs transition-all duration-200 hover:brightness-125 active:scale-[0.98]"
                  style={{
                    background: "rgba(231,76,60,0.10)",
                    border: "1px solid rgba(231,76,60,0.25)",
                    color: "#E74C3C",
                  }}
                >
                  {showMistakes ? "Show less" : `Show all ${mistakes.length} mistakes`}
                </button>
              )}
            </div>
          )}
        </div>{/* ── end RIGHT column ── */}

        </div>{/* ── end 2-column debrief ── */}
      </div>
    </div>
  );
}
