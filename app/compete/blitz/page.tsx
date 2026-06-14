"use client";

// Blitz Sprint — the timed competitive game.
//
// Lives under /compete (not /games) because Blitz is a Compete feature
// thematically: timed, 2× Fangs, leaderboards. Moved out of /games on
// 2026-05-26 per CEO call — see the matching deletion in app/games/page.tsx
// for context.
//
// Three phases live in one component as a state machine: setup → blitz →
// results. The setup screen is the "hype launch" view; results renders
// the data-rich post-run insights (personal-best delta, longest streak,
// mistake review, plays-today).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { cdnUrl } from "@/lib/cdn";
import { apiPost, apiGet } from "@/lib/api-client";
import { useHeartbeat } from "@/lib/use-heartbeat";
import BlitzMode from "@/components/Ninny/BlitzMode";
import type { MCQQuestion } from "@/lib/ninny";
import type { NinnyWrongAnswer } from "@/components/Ninny/MultipleChoiceMode";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  Brain,
  Lightning,
  Target,
  Fire,
  BookOpen,
  Trophy,
  Dna,
  Flask,
  Binoculars,
  Calculator,
  Scroll,
  Globe,
  Bank,
  StarFour,
  CaretLeft,
} from "@phosphor-icons/react";

// ── Constants ────────────────────────────────────────────────

type Phase = "setup" | "blitz" | "results";

const BLITZ_RULES: { icon: string | null; Icon?: PhosphorIcon; label: string; desc: string }[] = [
  { icon: "⏱", label: "60 SECONDS", desc: "Race the clock" },
  { icon: null, Icon: Brain, label: "ALL SUBJECTS", desc: "Random mix" },
  { icon: null, Icon: Lightning, label: "2× FANGS", desc: "Per correct answer" },
];

const DAILY_LIMIT = 99;

// ── Per-day play tracking (localStorage) ─────────────────────

function getDailyPlays(): number {
  if (typeof window === "undefined") return 0;
  const key = `lionade_plays_blitz_${new Date().toISOString().split("T")[0]}`;
  return parseInt(localStorage.getItem(key) ?? "0");
}

function incrementDailyPlays() {
  if (typeof window === "undefined") return;
  const key = `lionade_plays_blitz_${new Date().toISOString().split("T")[0]}`;
  const current = parseInt(localStorage.getItem(key) ?? "0");
  localStorage.setItem(key, String(current + 1));
}

// ── Component ────────────────────────────────────────────────

export default function CompeteBlitzPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { stats, mutate: mutateStats } = useUserStats(user?.id);

  const [phase, setPhase] = useState<Phase>("setup");
  const [questions, setQuestions] = useState<MCQQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number; wrongAnswers: NinnyWrongAnswer[]; longestStreak: number } | null>(null);
  const [best, setBest] = useState<number>(0);
  const [fangsEarned, setFangsEarned] = useState<number | null>(null);

  // Heartbeat — fires while user is on the page so the AFK reaper doesn't
  // mistakenly clear a blitz-in-progress active_session pin. We use the
  // user-id as the surface id since Blitz doesn't have a session row.
  useHeartbeat(phase === "blitz" && user?.id ? "quiz" : null, user?.id ?? null);

  // Load personal best from localStorage on mount.
  useEffect(() => {
    try {
      const b = localStorage.getItem("lionade_blitz_best");
      if (b) setBest(parseInt(b));
    } catch {}
  }, []);

  // Tier 3 — clear any stale Blitz state row on page mount so a previous
  // tab's abandoned run doesn't haunt the setup screen. We can't usefully
  // RESUME a Blitz mid-run (the timer + streak + recent[] window live
  // inside BlitzMode's local hooks/refs — see follow-up note), so V1 is
  // "clean slate on every visit." The state row IS still useful as a
  // breadcrumb for the cross-tab cross-game redirect logic in
  // ActiveSessionToast — that toast reads active_session, not this row.
  useEffect(() => {
    void apiPost("/api/quiz/state", { game_type: "blitz", state: null });
  }, []);

  const awardFangs = useCallback(async (amount: number) => {
    if (!user?.id || amount <= 0) return;
    setFangsEarned(amount); // optimistic
    const res = await apiPost<{ awarded?: number }>("/api/games/reward", { amount, gameType: "blitz" });
    // Honor the server's actual award — blitz pays at most once per day.
    if (res.ok && typeof res.data?.awarded === "number" && res.data.awarded !== amount) {
      setFangsEarned(res.data.awarded);
    }
    mutateUserStats(user.id);
    mutateStats?.();
  }, [user?.id, mutateStats]);

  const launchBlitz = useCallback(async () => {
    setLoading(true);
    const res = await apiGet<{ questions: MCQQuestion[] }>("/api/games/blitz/questions");
    if (res.ok && res.data?.questions?.length) {
      setQuestions(res.data.questions);
      setResult(null);
      setFangsEarned(null);
      setPhase("blitz");
      incrementDailyPlays();
    } else {
      setQuestions([]);
    }
    setLoading(false);
  }, []);

  const handleComplete = useCallback(async (r: { score: number; total: number; wrongAnswers: NinnyWrongAnswer[]; longestStreak: number }) => {
    setResult(r);
    setPhase("results");
    const earned = r.score * 2;
    if (earned > 0) await awardFangs(earned);
    if (r.score > best) {
      setBest(r.score);
      localStorage.setItem("lionade_blitz_best", String(r.score));
    }
  }, [awardFangs, best]);

  const playAgain = useCallback(() => {
    setResult(null);
    setFangsEarned(null);
    setPhase("setup");
  }, []);

  // ── SETUP ──────────────────────────────────────────────────
  if (phase === "setup") {
    const plays = getDailyPlays();
    const remaining = DAILY_LIMIT - plays;
    const canPlay = remaining > 0;

    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8 overflow-hidden">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
            <Link
              href="/compete"
              className="inline-flex items-center gap-1.5 text-cream/30 text-xs mb-4 hover:text-cream/50 transition"
            >
              <CaretLeft size={12} weight="bold" /> Back to Compete
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px_1fr] gap-6 items-center min-h-[calc(100vh-180px)]">
              {/* LEFT: How it works + tips */}
              <div className="hidden lg:flex flex-col gap-4 animate-slide-up" style={{ animationDelay: "0.1s" }}>
                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(255,107,0,0.06) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(255,107,0,0.12)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-4">How It Works</p>
                  <div className="space-y-3">
                    {[
                      { step: "01", text: "Questions from all subjects appear randomly" },
                      { step: "02", text: "Tap the correct answer as fast as you can" },
                      { step: "03", text: "Wrong answers don't end the game. Keep going" },
                      { step: "04", text: "When time's up, you earn 2 Fangs per correct answer" },
                    ].map((s, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="font-bebas text-lg tracking-wider shrink-0" style={{ color: "rgba(255,107,0,0.4)" }}>{s.step}</span>
                        <p className="text-cream/40 text-xs font-syne leading-relaxed">{s.text}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(255,215,0,0.04) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(255,215,0,0.1)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-3">Pro Tips</p>
                  <div className="space-y-2">
                    {[
                      { Icon: Target, text: "Speed matters. Don't overthink it" },
                      { Icon: Fire, text: "Build streaks for that dopamine hit" },
                      { Icon: BookOpen, text: "Review your mistakes after each round" },
                    ].map((tip, i) => {
                      const TipIcon = tip.Icon;
                      return (
                        <p key={i} className="text-cream/30 text-xs font-syne">
                          <TipIcon size={14} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" />
                          {tip.text}
                        </p>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* CENTER: Launch card */}
              <div className="relative">
                <div className="absolute -inset-8 rounded-3xl opacity-30 blur-2xl pointer-events-none"
                  style={{ background: "radial-gradient(ellipse, rgba(255,107,0,0.15) 0%, transparent 70%)" }} />

                <div className="relative rounded-3xl p-8 sm:p-10 text-center" style={{
                  background: "linear-gradient(160deg, rgba(255,107,0,0.1) 0%, rgba(10,10,20,0.95) 30%, rgba(10,10,20,0.98) 100%)",
                  border: "1px solid rgba(255,107,0,0.2)",
                  boxShadow: "0 0 60px rgba(255,107,0,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
                }}>
                  <div className="absolute left-1/2 top-12 -translate-x-1/2 w-48 h-48 rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(255,107,0,0.12) 0%, transparent 70%)", animation: "pulse 3s ease-in-out infinite" }} />

                  <div className="relative">
                    <p className="text-8xl mb-3 flex items-center justify-center" style={{ filter: "drop-shadow(0 0 25px rgba(255,107,0,0.6))" }}>
                      <Lightning size={96} weight="fill" aria-hidden="true" />
                    </p>
                    <h1 className="font-bebas text-6xl sm:text-7xl tracking-wider mb-1"
                      style={{
                        background: "linear-gradient(135deg, #FF6B00 0%, #FFD700 50%, #FF6B00 100%)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        filter: "drop-shadow(0 0 15px rgba(255,107,0,0.3))",
                      }}>
                      BLITZ SPRINT
                    </h1>
                    <p className="text-cream/30 text-sm font-syne mb-8">How many can you get right?</p>

                    {/* Rules row */}
                    <div className="grid grid-cols-3 gap-2 mb-8">
                      {BLITZ_RULES.map((rule, i) => {
                        const RuleIcon = rule.Icon;
                        return (
                          <div key={i} className="rounded-xl py-3 px-2" style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,107,0,0.1)",
                          }}>
                            <p className="text-xl mb-0.5 flex items-center justify-center">
                              {RuleIcon ? (
                                <RuleIcon size={24} weight="regular" aria-hidden="true" />
                              ) : (
                                rule.icon
                              )}
                            </p>
                            <p className="font-bebas text-[11px] tracking-wider text-cream/70">{rule.label}</p>
                            <p className="text-cream/20 text-[8px] font-syne">{rule.desc}</p>
                          </div>
                        );
                      })}
                    </div>

                    {best > 0 && (
                      <div className="flex justify-center mb-6">
                        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full"
                          style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.15)" }}>
                          <Trophy size={14} weight="regular" aria-hidden="true" />
                          <span className="font-bebas text-xs tracking-wider text-gold/60">Best: {best} correct</span>
                        </div>
                      </div>
                    )}

                    <button
                      onClick={canPlay ? launchBlitz : undefined}
                      disabled={!canPlay || loading}
                      className="relative w-full font-bebas text-3xl tracking-widest py-5 rounded-2xl transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed group"
                      style={{
                        background: "linear-gradient(135deg, #FF6B00 0%, #FF8C00 50%, #FFD700 100%)",
                        color: "#fff",
                        boxShadow: canPlay ? "0 0 40px rgba(255,107,0,0.35), 0 8px 30px rgba(0,0,0,0.4)" : undefined,
                      }}>
                      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                        style={{ boxShadow: "0 0 40px rgba(255,107,0,0.5), inset 0 0 20px rgba(255,255,255,0.08)" }} />
                      {loading ? (
                        <span className="flex items-center justify-center gap-3 relative z-10">
                          <div className="w-6 h-6 rounded-full border-2 border-white border-t-transparent animate-spin" />
                          LOADING...
                        </span>
                      ) : <span className="relative z-10">START</span>}
                    </button>
                    <p className="text-cream/15 text-[10px] mt-3 font-syne">
                      {!canPlay ? "No plays left today" : `${remaining} play${remaining !== 1 ? "s" : ""} left today`}
                    </p>
                  </div>
                </div>
              </div>

              {/* RIGHT: Stats + rewards */}
              <div className="hidden lg:flex flex-col gap-4 animate-slide-up" style={{ animationDelay: "0.15s" }}>
                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(255,215,0,0.06) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(255,215,0,0.12)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-4">Rewards</p>
                  <div className="space-y-3">
                    {[
                      { label: "Per correct answer", value: "2", icon: cdnUrl("/F.png") },
                      { label: "Max per game (30 correct)", value: "60", icon: cdnUrl("/F.png") },
                      { label: "Daily plays", value: String(DAILY_LIMIT), icon: null },
                    ].map((r, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-cream/35 text-xs font-syne">{r.label}</span>
                        <div className="flex items-center gap-1">
                          {r.icon && <img src={r.icon} alt="" className="w-3.5 h-3.5 object-contain" />}
                          <span className="font-bebas text-base tracking-wider text-gold/70">{r.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(74,144,217,0.05) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(74,144,217,0.1)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-3">Subjects Mixed</p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { label: "Biology", Icon: Dna, weight: "regular" as const },
                      { label: "Chemistry", Icon: Flask, weight: "regular" as const },
                      { label: "Physics", Icon: Binoculars, weight: "regular" as const },
                      { label: "Math", Icon: Calculator, weight: "regular" as const },
                      { label: "History", Icon: Scroll, weight: "regular" as const },
                      { label: "Earth Sci", Icon: Globe, weight: "regular" as const },
                      { label: "Social", Icon: Bank, weight: "regular" as const },
                      { label: "Astronomy", Icon: StarFour, weight: "fill" as const },
                    ]).map((s, i) => {
                      const SubjectIcon = s.Icon;
                      return (
                        <span key={i} className="flex items-center gap-1 text-[10px] text-cream/30 font-syne px-2 py-1 rounded-full"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <SubjectIcon size={14} weight={s.weight} aria-hidden="true" />
                          {s.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(168,85,247,0.05) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(168,85,247,0.1)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-3">Your Stats</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center">
                      <p className="font-bebas text-2xl text-cream/60">{stats?.coins ?? 0}</p>
                      <p className="text-cream/20 text-[9px] font-syne">Total Fangs</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bebas text-2xl text-cream/60">{stats?.streak ?? 0}</p>
                      <p className="text-cream/20 text-[9px] font-syne">Day Streak</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ── GAME ───────────────────────────────────────────────────
  if (phase === "blitz") {
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <BlitzMode
              questions={questions}
              playsToday={getDailyPlays()}
              playsLimit={DAILY_LIMIT}
              onComplete={handleComplete}
            />
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ── RESULTS ────────────────────────────────────────────────
  if (phase === "results" && result) {
    const accuracy = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
    const isNewBest = result.score >= best && result.score > 0;
    const hasPriorBest = best > 0 && !isNewBest;
    const deltaToBest = hasPriorBest ? result.score - best : 0;

    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">
            <div className="text-center mb-8 animate-slide-up">
              <span className="text-5xl mb-3 flex items-center justify-center">
                <Lightning size={52} weight="fill" aria-hidden="true" />
              </span>
              <h2 className="font-bebas text-5xl text-cream tracking-wider mb-1">TIME&apos;S UP!</h2>
              {isNewBest && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3"
                  style={{ background: "rgba(255,215,0,0.15)", border: "1px solid rgba(255,215,0,0.3)" }}>
                  <span className="text-gold text-xs font-bold">NEW PERSONAL BEST!</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,215,0,0.2)" }}>
                <p className="font-bebas text-4xl text-gold">{result.score}</p>
                <p className="text-cream/30 text-[10px] uppercase tracking-wider">Correct</p>
              </div>
              <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-bebas text-4xl text-cream">{result.total}</p>
                <p className="text-cream/30 text-[10px] uppercase tracking-wider">Attempted</p>
              </div>
              <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-bebas text-4xl" style={{ color: accuracy >= 80 ? "#22C55E" : accuracy >= 50 ? "#FBBF24" : "#EF4444" }}>{accuracy}%</p>
                <p className="text-cream/30 text-[10px] uppercase tracking-wider">Accuracy</p>
              </div>
            </div>

            <div className="text-center mb-4 animate-slide-up" style={{ animationDelay: "0.12s" }}>
              {isNewBest ? (
                <p className="font-bebas text-base tracking-wider text-gold">
                  You set a new personal best
                </p>
              ) : hasPriorBest ? (
                <p className="font-bebas text-base tracking-wider text-cream/60">
                  Your best <span className="text-gold">{best}</span>
                  <span className="text-cream/30 mx-2">·</span>
                  <span className={deltaToBest >= 0 ? "text-emerald-400" : "text-red-400/80"}>
                    {deltaToBest >= 0 ? `+${deltaToBest}` : deltaToBest} this run
                  </span>
                </p>
              ) : (
                <p className="font-bebas text-base tracking-wider text-cream/40">
                  First run. Beat <span className="text-gold">{result.score}</span> next time.
                </p>
              )}
            </div>

            <div className="flex items-center justify-center gap-4 mb-6 animate-slide-up text-[11px] font-bebas tracking-widest uppercase text-cream/40" style={{ animationDelay: "0.14s" }}>
              <span className="inline-flex items-center gap-1.5">
                <Fire size={11} weight="fill" aria-hidden="true" color="#A855F7" />
                <span>Longest streak <span className="text-cream/70 ml-1">{result.longestStreak}</span></span>
              </span>
              <span className="text-cream/15">|</span>
              <span>Plays today <span className="text-cream/70 ml-1">{getDailyPlays()}/{DAILY_LIMIT}</span></span>
            </div>

            {fangsEarned !== null && fangsEarned > 0 && (
              <div className="flex items-center justify-center gap-2 mb-6 animate-slide-up" style={{ animationDelay: "0.15s" }}>
                <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl" style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.25)" }}>
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
                  <span className="font-bebas text-2xl text-gold tracking-wider">+{fangsEarned}</span>
                  <span className="text-gold/40 text-xs ml-1">earned</span>
                </div>
              </div>
            )}

            {result.wrongAnswers.length > 0 && (
              <div className="mb-6 animate-slide-up" style={{ animationDelay: "0.2s" }}>
                <p className="font-bebas text-sm text-cream/40 tracking-widest uppercase mb-3">
                  Review Mistakes ({result.wrongAnswers.length})
                </p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {result.wrongAnswers.map((wa, i) => (
                    <div key={i} className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                      <p className="text-cream text-xs font-semibold mb-1.5">{wa.question}</p>
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        <span className="text-red-400">Your answer: {wa.userAnswer}</span>
                        <span className="text-green-400">Correct: {wa.correctAnswer}</span>
                      </div>
                      {wa.explanation && (
                        <p className="text-cream/25 text-[10px] mt-1">{wa.explanation}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-center animate-slide-up" style={{ animationDelay: "0.25s" }}>
              <button onClick={playAgain}
                className="font-bebas text-lg tracking-wider px-8 py-3 rounded-xl transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg, #FF6B00 0%, #FF8C00 100%)", color: "#fff" }}>
                Play Again
              </button>
              <button onClick={() => router.push("/compete")}
                className="font-bebas text-lg tracking-wider px-8 py-3 rounded-xl transition-all active:scale-95"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(238,244,255,0.5)" }}>
                Back to Compete
              </button>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return null;
}
