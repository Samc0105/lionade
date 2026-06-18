"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api-client";
import { getQuizQuestions, checkAnswer } from "@/lib/db";
import type { Subject } from "@/types";
import {
  MathOperations,
  Flask,
  BookOpen,
  Globe,
  Code,
  Cloud,
  CurrencyDollar,
  Notepad,
  Plant,
  BookOpenText,
  Fire,
  Lightning,
  Target,
  Rocket,
  Trophy,
  Barbell,
  PawPrint,
  Check,
} from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import type { ComponentType } from "react";

/* ── Subject categories ──────────────────────────────────────── */

type IconComp = ComponentType<IconProps>;

const SUBJECTS: Array<{ label: string; dbSubject: Subject; Icon: IconComp; color: string }> = [
  { label: "Math", dbSubject: "Math" as Subject, Icon: MathOperations, color: "#EF4444" },
  { label: "Science", dbSubject: "Science" as Subject, Icon: Flask, color: "#22C55E" },
  { label: "Humanities", dbSubject: "Humanities" as Subject, Icon: BookOpen, color: "#A855F7" },
  { label: "Languages", dbSubject: "Languages" as Subject, Icon: Globe, color: "#3B82F6" },
  { label: "Tech & Coding", dbSubject: "Tech & Coding" as Subject, Icon: Code, color: "#6B7280" },
  { label: "Cloud & IT", dbSubject: "Cloud & IT" as Subject, Icon: Cloud, color: "#F97316" },
  { label: "Finance & Business", dbSubject: "Finance & Business" as Subject, Icon: CurrencyDollar, color: "#EAB308" },
  { label: "Test Prep", dbSubject: "Test Prep" as Subject, Icon: Notepad, color: "#EC4899" },
];

const DAILY_GOALS: Array<{ minutes: number; label: string; tag: string; Icon: IconComp }> = [
  { minutes: 5, label: "5 min", tag: "Casual", Icon: Plant },
  { minutes: 10, label: "10 min", tag: "Regular", Icon: BookOpenText },
  { minutes: 15, label: "15 min", tag: "Serious", Icon: Fire },
  { minutes: 20, label: "20 min", tag: "Intense", Icon: Lightning },
];

const TOTAL_STEPS = 5;

// Preset color wheel for the class-onboarding step. Same palette as the
// /classes/new modal so users see consistent options.
const CLASS_COLORS = [
  "#FFD700", "#4A90D9", "#A855F7", "#22C55E",
  "#EF4444", "#F97316", "#06B6D4", "#EAB308",
];

interface ClassDraft {
  name: string;
  shortCode: string;
  examDate: string; // YYYY-MM-DD
  color: string;
  emoji: string;
}

const EMPTY_CLASS_DRAFT: ClassDraft = {
  name: "",
  shortCode: "",
  examDate: "",
  color: CLASS_COLORS[0],
  emoji: "",
};

/* ── Diagnostic question type ────────────────────────────────── */

interface DiagQuestion {
  id: string;
  question: string;
  options: string[];
  difficulty: string;
}

/* ── Page ────────────────────────────────────────────────────── */

export default function OnboardingPage() {
  const { user, isLoading, refreshUser } = useAuth();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // Focus target for each step's primary heading. Moving focus here on
  // step change keeps keyboard + screen-reader users oriented as the
  // funnel advances (the just-clicked button unmounts on transition).
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  // Step 1: Subjects
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);

  // Step 2: Daily goal
  const [dailyMinutes, setDailyMinutes] = useState(0);
  const [goalType, setGoalType] = useState("");

  // Step 3: Level choice
  const [levelChoice, setLevelChoice] = useState<"scratch" | "diagnostic" | null>(null);

  // Step 4: Diagnostic quiz
  const [diagQuestions, setDiagQuestions] = useState<DiagQuestion[]>([]);
  const [diagIndex, setDiagIndex] = useState(0);
  const [diagScore, setDiagScore] = useState(0);
  const [diagAnswered, setDiagAnswered] = useState(false);
  const [diagCorrect, setDiagCorrect] = useState<boolean | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagDone, setDiagDone] = useState(false);
  // Distinguishes a load FAILURE (network/server error) from a genuinely
  // empty question bank. On failure we offer a retry instead of silently
  // downgrading the user to "beginner".
  const [diagError, setDiagError] = useState(false);

  // Step 5: Classes
  const [classDrafts, setClassDrafts] = useState<ClassDraft[]>([{ ...EMPTY_CLASS_DRAFT }]);

  // Speech bubble messages
  const SPEECHES: Record<number, string> = {
    1: "Hey! I'm Leo. Let's get you set up. What do you want to study?",
    2: "Nice picks! How much time can you study each day?",
    3: "Almost done! Want to start fresh or test your level?",
    4: levelChoice === "diagnostic"
      ? (diagDone ? "All done! Let's see your results..." : "Answer these 5 questions so I can find your level!")
      : "You're all set! Let's start learning!",
    5: "Last thing. Got specific classes you're studying for? Add them and Lionade builds your study around them.",
  };

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.dataset.theme = "dark";
  }, []);

  // Auth guard
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace("/login"); return; }

    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed, username")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.onboarding_completed || (profile?.username && profile.username.trim().length > 0)) {
        router.replace("/dashboard");
        return;
      }
      setReady(true);
    })();
  }, [user, isLoading, router]);

  // Move focus to the new step's heading on advance so keyboard and
  // screen-reader users are placed at the top of the fresh content
  // instead of being stranded on the unmounted button they just clicked.
  // The diagnostic (step 4) swaps sub-views without a step change, so we
  // also re-focus when the active question, loading, or results view flips.
  useEffect(() => {
    if (!ready) return;
    stepHeadingRef.current?.focus();
  }, [step, ready, diagIndex, diagDone, diagLoading]);

  // Load diagnostic questions
  const loadDiagnostic = useCallback(async () => {
    if (!selectedSubjects[0]) return;
    setDiagLoading(true);
    setDiagError(false);
    try {
      // Get a mix of difficulties
      const subj = SUBJECTS.find(s => s.label === selectedSubjects[0]);
      if (!subj) return;
      const qs = await getQuizQuestions(subj.dbSubject, "medium");
      setDiagQuestions(qs.slice(0, 5));
      setDiagIndex(0);
      setDiagScore(0);
      setDiagAnswered(false);
      setDiagCorrect(null);
      setDiagDone(false);
    } catch {
      // Real load failure (vs. an empty bank). Flag it so the UI offers a
      // retry rather than the bare "no questions" downgrade-to-beginner card.
      setDiagQuestions([]);
      setDiagError(true);
    } finally {
      setDiagLoading(false);
    }
  }, [selectedSubjects]);

  const handleDiagAnswer = async (answerIdx: number) => {
    if (diagAnswered || !diagQuestions[diagIndex]) return;
    setDiagAnswered(true);
    try {
      const { correct_answer } = await checkAnswer(diagQuestions[diagIndex].id);
      const correct = answerIdx === correct_answer;
      setDiagCorrect(correct);
      if (correct) setDiagScore(s => s + 1);
    } catch {
      setDiagCorrect(false);
    }
  };

  const nextDiagQuestion = () => {
    if (diagIndex + 1 >= diagQuestions.length) {
      setDiagDone(true);
    } else {
      setDiagIndex(i => i + 1);
      setDiagAnswered(false);
      setDiagCorrect(null);
    }
  };

  const getDiagLevel = (): string => {
    if (diagScore >= 4) return "advanced";
    if (diagScore >= 2) return "intermediate";
    return "beginner";
  };

  // Save and finish. Also creates any classes the user listed in step 5
  // (best-effort — we don't fail onboarding if a class insert errors).
  const handleFinish = async () => {
    if (!user) return;
    setSubmitting(true);
    setFinishError(null);

    const educationLevel = levelChoice === "diagnostic" ? getDiagLevel() : "beginner";

    const { error } = await supabase
      .from("profiles")
      .update({
        selected_subjects: selectedSubjects,
        daily_target_minutes: dailyMinutes,
        goal_type: goalType,
        education_level: educationLevel,
        onboarding_completed: true,
      })
      .eq("id", user.id);

    if (error) {
      console.error("[Onboarding] Save failed:", error.message);
      setFinishError("Something went wrong saving your setup. Please try again.");
      setSubmitting(false);
      return;
    }

    // Create any classes drafted in step 5. Fire sequentially so the
    // server-side `position` ordering matches the UI order. Best-effort —
    // a failed class insert shouldn't block onboarding completion.
    for (const c of classDrafts) {
      const cleanName = c.name.trim();
      if (cleanName.length < 2) continue;
      try {
        await apiPost("/api/classes", {
          name: cleanName,
          shortCode: c.shortCode.trim() || null,
          color: c.color,
          emoji: c.emoji.trim() || null,
        });
      } catch (e) {
        console.error("[Onboarding] Class create failed:", (e as Error).message);
      }
    }

    await refreshUser();
    router.replace("/dashboard");
  };

  const toggleSubject = (label: string) => {
    setSelectedSubjects(prev =>
      prev.includes(label) ? prev.filter(s => s !== label) : [...prev, label]
    );
  };

  const progress = step / TOTAL_STEPS;

  // Loading state
  if (isLoading || !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" aria-hidden="true" />
          <p className="font-bebas text-xl text-cream/60 tracking-wider">LOADING</p>
        </div>
      </div>
    );
  }

  // Results icon for diagnostic
  const resultsIcon = (size: number) => {
    if (diagScore >= 4) return <Trophy size={size} weight="fill" color="#FFD700" aria-hidden="true" />;
    if (diagScore >= 2) return <Barbell size={size} weight="fill" color="#4A90D9" aria-hidden="true" />;
    return <Plant size={size} weight="fill" color="#22C55E" aria-hidden="true" />;
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <h1 className="sr-only">Set up your Lionade account</h1>

      {/* Progress bar */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex items-center justify-between mb-2 min-h-[28px]">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(s => s - 1)}
              className="text-cream/60 hover:text-cream text-sm font-syne transition-colors
                rounded-md px-2 py-1 -ml-2 min-h-[44px] inline-flex items-center
                focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            >
              &larr; Back
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <p className="text-cream/55 text-xs font-syne" aria-live="polite">
            Step {step} of {TOTAL_STEPS}
          </p>
        </div>
        <div
          className="w-full h-2.5 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.08)" }}
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-label={`Onboarding progress, step ${step} of ${TOTAL_STEPS}`}
        >
          <div
            className={`h-full rounded-full ${reduceMotion ? "" : "transition-all duration-500 ease-out"}`}
            style={{ width: `${progress * 100}%`, background: "linear-gradient(90deg, #4A90D9, #22C55E)" }}
          />
        </div>
      </div>

      {/* Lion mascot + speech bubble */}
      <div className="flex items-start gap-3 max-w-lg w-full mb-8 animate-slide-up">
        <div className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #FFD70030, #F9731620)", border: "2px solid #FFD70040" }}>
          <PawPrint size={32} weight="fill" color="#FFD700" aria-hidden="true" />
        </div>
        <div className="flex-1 rounded-2xl rounded-tl-sm px-5 py-3.5"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <p className="text-cream text-sm font-syne leading-relaxed" aria-live="polite">
            {SPEECHES[step]}
          </p>
        </div>
      </div>

      {/* Content card */}
      <div className="w-full max-w-lg animate-slide-up" style={{ animationDelay: "0.05s" }}>

        {/* ═══ STEP 1: SUBJECTS ═══ */}
        {step === 1 && (
          <div>
            <h2 ref={stepHeadingRef} tabIndex={-1}
              className="font-bebas text-3xl text-cream tracking-wider text-center mb-6 outline-none">
              WHAT DO YOU WANT TO STUDY?
            </h2>
            <div className="grid grid-cols-2 gap-3 mb-8" role="group" aria-label="Choose your subjects">
              {SUBJECTS.map(s => {
                const selected = selectedSubjects.includes(s.label);
                return (
                  <button key={s.label} type="button" onClick={() => toggleSubject(s.label)}
                    aria-pressed={selected}
                    className={`p-4 rounded-2xl border text-left transition-all duration-200 motion-safe:hover:-translate-y-0.5
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
                      selected
                        ? "border-electric/60 shadow-lg"
                        : "border-white/10 hover:border-white/20"
                    }`}
                    style={{
                      background: selected ? `${s.color}15` : "rgba(255,255,255,0.03)",
                      boxShadow: selected ? `0 0 20px ${s.color}20` : "none",
                    }}
                  >
                    <span className="block mb-2" style={{ color: s.color }}>
                      <s.Icon size={28} weight={selected ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                    </span>
                    <p className={`text-sm font-bold ${selected ? "text-cream" : "text-cream/70"}`}>
                      {s.label}
                    </p>
                    {selected && (
                      <span className="text-electric text-xs font-bold mt-1 inline-flex items-center gap-1">
                        <Check size={14} weight="bold" color="currentColor" aria-hidden="true" />
                        Selected
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={selectedSubjects.length === 0}
              className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm bg-electric text-white
                hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20
                focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue &rarr;
            </button>
          </div>
        )}

        {/* ═══ STEP 2: DAILY GOAL ═══ */}
        {step === 2 && (
          <div>
            <h2 ref={stepHeadingRef} tabIndex={-1}
              className="font-bebas text-3xl text-cream tracking-wider text-center mb-6 outline-none">
              HOW MUCH TIME DO YOU HAVE?
            </h2>
            <div className="space-y-3 mb-8" role="group" aria-label="Choose your daily goal">
              {DAILY_GOALS.map(g => {
                const selected = dailyMinutes === g.minutes;
                return (
                  <button key={g.minutes} type="button"
                    onClick={() => { setDailyMinutes(g.minutes); setGoalType(g.tag); }}
                    aria-pressed={selected}
                    className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all duration-200
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
                      selected
                        ? "border-electric/60 shadow-lg"
                        : "border-white/10 hover:border-white/20"
                    }`}
                    style={{ background: selected ? "rgba(74,144,217,0.1)" : "rgba(255,255,255,0.03)" }}
                  >
                    <span className={selected ? "text-electric" : "text-cream/70"}>
                      <g.Icon size={28} weight={selected ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                    </span>
                    <div className="flex-1">
                      <p className={`font-bold text-sm ${selected ? "text-cream" : "text-cream/70"}`}>
                        {g.label} / day
                      </p>
                      <p className={`text-xs mt-0.5 ${selected ? "text-electric" : "text-cream/55"}`}>
                        {g.tag}
                      </p>
                    </div>
                    {selected && (
                      <span className="text-electric">
                        <Check size={20} weight="bold" color="currentColor" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={dailyMinutes === 0}
              className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm bg-electric text-white
                hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20
                focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue &rarr;
            </button>
          </div>
        )}

        {/* ═══ STEP 3: LEVEL CHOICE ═══ */}
        {step === 3 && (
          <div>
            <h2 ref={stepHeadingRef} tabIndex={-1}
              className="font-bebas text-3xl text-cream tracking-wider text-center mb-6 outline-none">
              FIND YOUR LEVEL
            </h2>
            <div className="space-y-3 mb-8" role="group" aria-label="Choose how to start">
              <button
                type="button"
                onClick={() => setLevelChoice("scratch")}
                aria-pressed={levelChoice === "scratch"}
                className={`w-full flex items-center gap-4 p-5 rounded-2xl border text-left transition-all duration-200
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
                  levelChoice === "scratch"
                    ? "border-electric/60 shadow-lg"
                    : "border-white/10 hover:border-white/20"
                }`}
                style={{ background: levelChoice === "scratch" ? "rgba(74,144,217,0.1)" : "rgba(255,255,255,0.03)" }}
              >
                <span className={levelChoice === "scratch" ? "text-electric" : "text-cream/70"}>
                  <Plant size={32} weight={levelChoice === "scratch" ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                </span>
                <div>
                  <p className={`font-bold ${levelChoice === "scratch" ? "text-cream" : "text-cream/70"}`}>
                    Start from scratch
                  </p>
                  <p className="text-cream/55 text-xs mt-0.5">
                    Begin with the basics and work your way up
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setLevelChoice("diagnostic")}
                aria-pressed={levelChoice === "diagnostic"}
                className={`w-full flex items-center gap-4 p-5 rounded-2xl border text-left transition-all duration-200
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
                  levelChoice === "diagnostic"
                    ? "border-gold/60 shadow-lg"
                    : "border-white/10 hover:border-white/20"
                }`}
                style={{ background: levelChoice === "diagnostic" ? "rgba(255,215,0,0.08)" : "rgba(255,255,255,0.03)" }}
              >
                <span className={levelChoice === "diagnostic" ? "text-gold" : "text-cream/70"}>
                  <Target size={32} weight={levelChoice === "diagnostic" ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                </span>
                <div>
                  <p className={`font-bold ${levelChoice === "diagnostic" ? "text-cream" : "text-cream/70"}`}>
                    Find my level
                  </p>
                  <p className="text-cream/55 text-xs mt-0.5">
                    Take a quick 5-question diagnostic quiz
                  </p>
                </div>
              </button>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (levelChoice === "diagnostic") {
                  setStep(4);
                  await loadDiagnostic();
                } else if (levelChoice === "scratch") {
                  // Skip diagnostic, but funnel through step 5 (classes)
                  // so users always get the chance to set up their
                  // class notebooks before landing on the dashboard.
                  setStep(5);
                }
              }}
              disabled={!levelChoice || submitting}
              className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm bg-electric text-white
                hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20
                focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {submitting ? "Saving..." : levelChoice === "scratch" ? "Continue →" : "Start Quiz →"}
            </button>
          </div>
        )}

        {/* ═══ STEP 4: DIAGNOSTIC QUIZ ═══ */}
        {step === 4 && (
          <div>
            {diagLoading ? (
              <div className="text-center py-12" role="status" aria-live="polite">
                <div className="w-10 h-10 rounded-full border-2 border-electric border-t-transparent animate-spin mx-auto mb-3" aria-hidden="true" />
                <p className="text-cream/60 text-sm">Loading questions...</p>
              </div>
            ) : diagDone ? (
              /* Results */
              <div className="text-center animate-slide-up">
                <div className="flex justify-center mb-4">
                  {resultsIcon(64)}
                </div>
                <h2 ref={stepHeadingRef} tabIndex={-1}
                  className="font-bebas text-3xl text-cream tracking-wider mb-2 outline-none">
                  {diagScore >= 4 ? "ADVANCED" : diagScore >= 2 ? "INTERMEDIATE" : "BEGINNER"}
                </h2>
                <p className="text-cream/70 text-sm mb-2">
                  You got {diagScore} out of {diagQuestions.length} correct
                </p>
                <p className="text-cream/55 text-xs mb-8">
                  {diagScore >= 4
                    ? "Impressive! You'll start with challenging content."
                    : diagScore >= 2
                    ? "Good foundation! We'll build from here."
                    : "No worries! We'll start with the fundamentals."}
                </p>
                <button
                  type="button"
                  onClick={() => setStep(5)}
                  className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm bg-electric text-white
                    hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                    inline-flex items-center justify-center gap-2"
                >
                  Continue →
                </button>
              </div>
            ) : diagError ? (
              /* Load FAILED (network/server). Offer a retry instead of
                 silently downgrading the user to "beginner". */
              <div className="text-center py-8">
                <h2 ref={stepHeadingRef} tabIndex={-1}
                  className="font-bebas text-2xl text-cream tracking-wider mb-2 outline-none">
                  COULDN&apos;T LOAD THE QUIZ
                </h2>
                <p className="text-cream/60 text-sm mb-5">
                  Something went wrong loading your diagnostic. Check your connection and try again.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void loadDiagnostic(); }}
                    className="flex-1 min-h-[44px] py-3.5 rounded-xl font-bold text-sm bg-electric text-white
                      hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(5)}
                    className="flex-1 min-h-[44px] py-3.5 rounded-xl font-bold text-sm border border-white/[0.15]
                      text-cream/70 hover:text-cream hover:border-white/[0.3] transition-colors
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            ) : diagQuestions.length === 0 ? (
              /* Genuinely empty bank for this subject. Skip diagnostic. */
              <div className="text-center py-8">
                <h2 ref={stepHeadingRef} tabIndex={-1}
                  className="text-cream/70 text-sm mb-4 outline-none">
                  No diagnostic questions available yet for this subject.
                </h2>
                <button
                  type="button"
                  onClick={() => setStep(5)}
                  className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm bg-electric text-white
                    hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                >
                  Continue →
                </button>
              </div>
            ) : (
              /* Active question */
              <div className="animate-slide-up">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-cream/60 text-xs font-syne">
                    Question {diagIndex + 1} of {diagQuestions.length}
                  </p>
                  <p className="text-cream/60 text-xs font-syne">
                    Score: <span className="text-cream font-bold">{diagScore}</span>
                  </p>
                </div>

                {/* Question progress dots */}
                <div className="flex gap-1.5 mb-5" aria-hidden="true">
                  {diagQuestions.map((_, i) => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full ${reduceMotion ? "" : "transition-all duration-300"}`}
                      style={{
                        background: i < diagIndex ? "#22C55E"
                          : i === diagIndex ? "#4A90D980"
                          : "rgba(255,255,255,0.08)"
                      }}
                    />
                  ))}
                </div>

                {/* Question text */}
                <div className="rounded-2xl p-5 mb-5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <h2 ref={stepHeadingRef} tabIndex={-1}
                    className="text-cream text-sm font-syne leading-relaxed outline-none">
                    {diagQuestions[diagIndex].question}
                  </h2>
                </div>

                {/* Options */}
                <div className="space-y-2.5 mb-5" role="group" aria-label="Answer choices">
                  {diagQuestions[diagIndex].options.map((opt, idx) => (
                    <button key={idx} type="button" onClick={() => handleDiagAnswer(idx)}
                      disabled={diagAnswered}
                      className={`w-full text-left p-4 rounded-xl border transition-all duration-200
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                        ${!diagAnswered ? "motion-safe:hover:-translate-y-0.5 hover:bg-white/5 cursor-pointer" : "cursor-default"}`}
                      style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}
                    >
                      <div className="flex items-start gap-3">
                        <span className="w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5"
                          style={{ borderColor: "rgba(255,255,255,0.2)" }} aria-hidden="true">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <p className="text-cream/80 text-sm font-syne">{opt}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Feedback + Next */}
                {diagAnswered && (
                  <div className="animate-slide-up">
                    <div className="rounded-xl p-3 mb-3 border" role="status" aria-live="polite"
                      style={{
                        background: diagCorrect ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                        borderColor: diagCorrect ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
                      }}>
                      <p className="font-bebas text-lg tracking-wider"
                        style={{ color: diagCorrect ? "#22C55E" : "#EF4444" }}>
                        {diagCorrect ? "Correct!" : "Incorrect"}
                      </p>
                    </div>
                    <button type="button" onClick={nextDiagQuestion}
                      className="w-full min-h-[44px] py-3 rounded-xl font-bold text-sm bg-electric text-white
                        hover:bg-electric/90 transition-all duration-200
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy">
                      {diagIndex + 1 >= diagQuestions.length ? "See Results" : "Next Question →"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ STEP 5: CLASSES ═══ */}
        {step === 5 && (
          <div className="animate-slide-up">
            <h2 ref={stepHeadingRef} tabIndex={-1}
              className="text-center font-bebas text-2xl text-cream tracking-wider mb-2 outline-none">
              YOUR CLASSES
            </h2>
            <p className="text-center text-cream/60 text-sm mb-6">
              College class? Cert prep? Add what you're studying for. Skip if none yet.
            </p>

            <div className="space-y-3 mb-4">
              {classDrafts.map((c, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border p-3 transition-colors"
                  style={{
                    borderColor: `${c.color}55`,
                    background: `${c.color}0a`,
                  }}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <input
                      value={c.emoji}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 4);
                        setClassDrafts(d => d.map((row, i) => i === idx ? { ...row, emoji: v } : row));
                      }}
                      placeholder="📐"
                      aria-label={`Emoji for class ${idx + 1}`}
                      className="w-12 min-h-[44px] rounded-lg bg-white/[0.04] border border-white/[0.08]
                        focus:border-electric/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70
                        px-2 py-2 text-[16px] text-center text-cream"
                    />
                    <input
                      value={c.name}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 80);
                        setClassDrafts(d => d.map((row, i) => i === idx ? { ...row, name: v } : row));
                      }}
                      placeholder="Class name"
                      aria-label={`Name for class ${idx + 1}`}
                      className="flex-1 min-h-[44px] rounded-lg bg-white/[0.04] border border-white/[0.08]
                        focus:border-electric/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70
                        px-3 py-2 text-[14px] text-cream placeholder:text-cream/45"
                    />
                    {classDrafts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setClassDrafts(d => d.filter((_, i) => i !== idx))}
                        aria-label={`Remove class ${idx + 1}`}
                        className="grid place-items-center w-11 h-11 rounded-lg text-cream/55 hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    )}
                  </div>
                  {/* Code input + color swatches. The swatch row wraps onto
                      its own line below the code input on narrow screens so the
                      40px-min touch targets don't squeeze the code field. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={c.shortCode}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 24);
                        setClassDrafts(d => d.map((row, i) => i === idx ? { ...row, shortCode: v } : row));
                      }}
                      placeholder="Code (optional)"
                      aria-label={`Code for class ${idx + 1} (optional)`}
                      className="w-full sm:flex-1 sm:w-auto min-h-[44px] rounded-lg bg-white/[0.04] border border-white/[0.08]
                        focus:border-electric/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70
                        px-3 py-1.5 text-[12px] text-cream placeholder:text-cream/45"
                    />
                    <div className="flex flex-wrap gap-0.5" role="group" aria-label={`Color for class ${idx + 1}`}>
                      {CLASS_COLORS.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => setClassDrafts(d => d.map((row, i) => i === idx ? { ...row, color: col } : row))}
                          aria-label={`Color ${col}`}
                          aria-pressed={c.color === col}
                          className={`w-10 h-10 grid place-items-center rounded-full transition-transform
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                            ${c.color === col ? "motion-safe:scale-110" : "motion-safe:hover:scale-105"}`}
                        >
                          <span
                            className="block w-5 h-5 rounded-full border-2"
                            style={{
                              backgroundColor: col,
                              borderColor: c.color === col ? "#ffffff80" : "#ffffff10",
                            }}
                            aria-hidden="true"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {classDrafts.length < 8 && (
              <button
                type="button"
                onClick={() => setClassDrafts(d => [...d, { ...EMPTY_CLASS_DRAFT }])}
                className="w-full min-h-[44px] rounded-lg border border-dashed border-white/[0.1] hover:border-white/[0.2]
                  text-cream/60 hover:text-cream font-mono text-[11px] uppercase tracking-[0.2em]
                  py-2.5 mb-5 transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                + Another class
              </button>
            )}

            {finishError && (
              <div
                role="alert"
                aria-live="assertive"
                className="mb-4 rounded-xl px-4 py-3 text-sm font-syne text-[#FCA5A5]"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                {finishError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFinish}
                disabled={submitting}
                className="flex-1 min-h-[44px] py-3.5 rounded-xl font-bold text-sm border border-white/[0.15]
                  text-cream/70 hover:text-cream hover:border-white/[0.3]
                  transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                {submitting ? "Saving…" : "Skip for now"}
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={submitting}
                className="flex-1 min-h-[44px] py-3.5 rounded-xl font-bold text-sm bg-electric text-white
                  hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                  disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {submitting ? "Saving…" : (
                  <>
                    Let&apos;s Go!
                    <Rocket size={16} weight="fill" color="currentColor" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
            <p className="text-center text-cream/55 text-[11px] mt-3 font-mono uppercase tracking-[0.2em]">
              You can edit or add more classes anytime
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
