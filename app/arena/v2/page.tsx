"use client";

// Arena V2 — duel arena UI (Phase 2A).
//
// Surfaces:
//   1. Lobby: subject picker, stake picker (250 gated at ELO 1500+),
//      Find Opponent, Challenge Friend (deferred TODO), "Searching..."
//      shimmer with honest dead-end fallback.
//   2. Consent gate: first-duel consent modal when ghost_consent_at is null.
//   3. Pre-match card: 2-3s reveal of opponent (Trainer or anonymized ghost).
//   4. Battle: HP bar gameplay UI with combo + comeback multipliers,
//      emoji reactions, ghost replay polling.
//   5. Results: winner/loser headline + Fang delta + return-to-lobby /
//      rematch (rematch deferred to V1.5).
//
// Gated server-side on isArenaV2Enabled(). When the flag is off we redirect
// to /arena so V1 keeps running for everyone else.
//
// Deferred to Phase 2B (placeholders only):
//   - 3-loss intervention card (flag is plumbed from /complete; we render
//     a TODO note on the results screen).
//   - Mismatched-Duel handicap UI (we just show the halved stake).
//   - Tiered loss cap UI feedback (we show a generic "Daily limit reached"
//     toast if capAlreadyReached returns true).
//   - 2-layer audio, Pro perks (themes, replay export).

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost, apiPatch } from "@/lib/api-client";
import { cdnUrl } from "@/lib/cdn";
import { isArenaV2Enabled } from "@/lib/arena-v2/feature-flag";
import { generateAnonHandle } from "@/lib/arena-v2/anon-handle";
import HpBar from "@/components/arena-v2/HpBar";
import EmojiReaction from "@/components/arena-v2/EmojiReaction";
import ConsentModal from "@/components/arena-v2/ConsentModal";
import GhostIdentity from "@/components/arena-v2/GhostIdentity";
import GhostEloCard from "@/components/arena-v2/GhostEloCard";

// ── Types ────────────────────────────────────────────────────

type Phase = "lobby" | "searching" | "no_ghost" | "prematch" | "battle" | "results";

interface ArenaQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
  difficulty: string;
  subject: string;
  timeLimit: number;
  cognitiveLoad: string;
}

interface ProfileSnap {
  id: string;
  coins: number;
  arena_elo: number;
  plan: string | null;
  ghost_consent_at: string | null;
  ghost_anon_handle: string | null;
}

interface QueueResponse {
  status: "matched" | "trainer_ninny" | "no_ghost_available";
  matchId?: string;
  ghostId?: string;
  isTrainer?: boolean;
  isMismatched?: boolean;
  effectiveWager?: number;
  subject?: string;
  error?: string;
}

interface GhostReplayResponse {
  status: "answered" | "still_thinking" | "skipped";
  selected_index?: number;
  time_ms?: number;
  correct?: boolean;
  error?: string;
}

interface AnswerResult {
  isCorrect: boolean;
  correctAnswer: number;
  explanation: string | null;
  pointsEarned: number;
  bothAnswered: boolean;
  opponentAnswer: {
    is_correct: boolean;
    points_earned: number;
    selected_answer: number;
    response_time_ms: number;
  } | null;
}

interface CompleteResponse {
  matchId: string;
  winnerId: string | null;
  livePoints: number;
  ghostPoints: number;
  newLiveElo: number;
  fangsDelta: number;
  capAlreadyReached: boolean;
  lossCap: { capFangs: number; label: string };
  shakeItOffDispensed: boolean;
  recordedGhostId: string | null;
  isTrainerMatch: boolean;
}

// ── Constants ────────────────────────────────────────────────

const STAKE_BASE = [10, 25, 50, 100];
const STAKE_HIGH = 250;
const STAKE_HIGH_MIN_ELO = 1500;

const COMBO_STEPS = [1, 1.5, 2, 3];
const COMBO_CAP = 3;

const COMEBACK_QS = new Set([7, 8, 9]); // zero-indexed Q8/9/10
const COMEBACK_MULT = 1.5;

const BASE_DAMAGE = 10;       // correct answer base damage to opponent
const SELF_DAMAGE = 5;        // wrong answer self damage
const SPEED_BONUS_MAX = 1.5;  // 1.0 → 1.5x by time remaining

const SUBJECTS: { id: string; label: string }[] = [
  { id: "algebra", label: "Algebra" },
  { id: "biology", label: "Biology" },
  { id: "chemistry", label: "Chemistry" },
  { id: "physics", label: "Physics" },
  { id: "earth-science", label: "Earth Science" },
  { id: "surprise-me", label: "Surprise Me" },
];

// ── Component ────────────────────────────────────────────────

export default function ArenaV2Page() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { user } = useAuth();

  // Flag-gate: redirect to V1 if disabled.
  useEffect(() => {
    if (!isArenaV2Enabled()) {
      router.replace("/arena");
    }
  }, [router]);

  // Phase state.
  const [phase, setPhase] = useState<Phase>("lobby");
  const [profile, setProfile] = useState<ProfileSnap | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Lobby state.
  const [subject, setSubject] = useState<string>("algebra");
  const [stake, setStake] = useState<number>(10);
  const [searchingMs, setSearchingMs] = useState(0);

  // Consent modal.
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);

  // Match state.
  const [matchId, setMatchId] = useState<string | null>(null);
  const [ghostId, setGhostId] = useState<string | null>(null);
  const [isTrainerMatch, setIsTrainerMatch] = useState(false);
  const [isMismatched, setIsMismatched] = useState(false);
  const [effectiveStake, setEffectiveStake] = useState(0);
  const [opponentAnonHandle, setOpponentAnonHandle] = useState<string>("Shadow Wolf 0000");
  const [opponentElo, setOpponentElo] = useState<number | null>(null);

  // Battle state.
  const [questions, setQuestions] = useState<ArenaQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [timeLeft, setTimeLeft] = useState(15);
  const [selected, setSelected] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [myHp, setMyHp] = useState(100);
  const [opHp, setOpHp] = useState(100);
  const [myCombo, setMyCombo] = useState(0);  // index into COMBO_STEPS
  const [opCombo, setOpCombo] = useState(0);
  const [myFlash, setMyFlash] = useState(0);
  const [opFlash, setOpFlash] = useState(0);
  const [ghostAnswerThisQ, setGhostAnswerThisQ] = useState<GhostReplayResponse | null>(null);

  const answerLocked = useRef(false);
  const qStartedAt = useRef(0);

  // Results state.
  const [finalResult, setFinalResult] = useState<CompleteResponse | null>(null);

  // ── Profile fetch ──────────────────────────────────────────

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, coins, arena_elo, plan, ghost_consent_at, ghost_anon_handle")
      .eq("id", user.id)
      .single();
    if (data) {
      setProfile({
        id: data.id,
        coins: data.coins ?? 0,
        arena_elo: data.arena_elo ?? 1000,
        plan: data.plan ?? null,
        ghost_consent_at: data.ghost_consent_at ?? null,
        ghost_anon_handle: data.ghost_anon_handle ?? null,
      });
    }
    setProfileLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  // Safe-side default: until profiles.birthdate exists (deferred to Phase 2B
  // when we ship Settings -> Privacy + age gating), force-anonymize every
  // viewer. This matches the under-18 default per privacy spec.
  const viewerIsAdult = false;

  const allowedStakes = useMemo(() => {
    const elo = profile?.arena_elo ?? 1000;
    return elo >= STAKE_HIGH_MIN_ELO ? [...STAKE_BASE, STAKE_HIGH] : STAKE_BASE;
  }, [profile?.arena_elo]);

  // ── Consent flow ───────────────────────────────────────────

  const acceptConsent = useCallback(async () => {
    setConsentBusy(true);
    const res = await apiPost<{ ghostConsentAt: string; ghostAnonHandle: string }>(
      "/api/arena/v2/consent",
      {},
    );
    setConsentBusy(false);
    if (!res.ok || !res.data) {
      console.error("[arena/v2] consent failed", res.error);
      setConsentOpen(false);
      return;
    }
    setProfile((p) =>
      p ? { ...p, ghost_consent_at: res.data!.ghostConsentAt, ghost_anon_handle: res.data!.ghostAnonHandle } : p,
    );
    setConsentOpen(false);
    void startMatchmaking(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const declineConsent = useCallback(() => {
    setConsentOpen(false);
  }, []);

  // ── Matchmaking ────────────────────────────────────────────

  const startMatchmaking = useCallback(
    async (skipConsentCheck = false) => {
      if (!user?.id || !profile) return;

      // Gate: needs consent before recording a ghost run.
      if (!skipConsentCheck && !profile.ghost_consent_at) {
        setConsentOpen(true);
        return;
      }

      // Stake budget check.
      if (profile.coins < stake) return;

      setPhase("searching");
      setSearchingMs(0);

      const t0 = Date.now();
      const minShimmerMs = 1500;

      // Resolve subject: surprise-me picks one from the 5 real subjects.
      const resolvedSubject = subject === "surprise-me"
        ? SUBJECTS[Math.floor(Math.random() * 5)].id
        : subject;

      const res = await apiPost<QueueResponse>("/api/arena/v2/queue", {
        subject: resolvedSubject,
        wager: stake,
      });

      const elapsed = Date.now() - t0;
      if (elapsed < minShimmerMs) {
        await new Promise((r) => setTimeout(r, minShimmerMs - elapsed));
      }

      if (!res.ok || !res.data) {
        console.error("[arena/v2] queue", res.error);
        setPhase("lobby");
        return;
      }
      const data = res.data;
      if (data.status === "no_ghost_available") {
        setPhase("no_ghost");
        return;
      }

      // Owner-real-username support: V2A always shows anonymized handle.
      // (Future: fetch ghost owner's profile for ghost_show_username + age.)
      const handle = data.ghostId
        ? generateAnonHandle(data.ghostId)
        : generateAnonHandle("unknown");

      setMatchId(data.matchId ?? null);
      setGhostId(data.ghostId ?? null);
      setIsTrainerMatch(!!data.isTrainer);
      setIsMismatched(!!data.isMismatched);
      setEffectiveStake(data.effectiveWager ?? stake);
      setOpponentAnonHandle(handle);
      setOpponentElo(null);

      // Load match (questions).
      if (data.matchId) {
        await loadMatch(data.matchId);
      }
    },
    [user?.id, profile, subject, stake], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Searching shimmer counter (purely visual).
  useEffect(() => {
    if (phase !== "searching") return;
    const iv = setInterval(() => setSearchingMs((m) => m + 100), 100);
    return () => clearInterval(iv);
  }, [phase]);

  // Notify-me opt-in stub for dead-end.
  const [notifyOptedIn, setNotifyOptedIn] = useState(false);
  const notifyMe = useCallback(() => {
    // V2A: no backend wiring yet (push surface deferred to V2.5+ on web).
    // We just acknowledge in-UI so Sam sees the flow.
    setNotifyOptedIn(true);
  }, []);

  // ── Match load ─────────────────────────────────────────────

  const loadMatch = useCallback(
    async (mId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiGet<any>(`/api/arena/match?id=${mId}`);
      if (!res.ok || !res.data) {
        setPhase("lobby");
        return;
      }
      const data = res.data;
      setQuestions(data.questions ?? []);

      // Opponent ELO from the ghost recording.
      const isP1 = data.match?.player1_id === user?.id;
      const opElo = isP1 ? data.match?.player2_elo_before : data.match?.player1_elo_before;
      setOpponentElo(opElo ?? null);

      // Mark active (idempotent on V2's already-active match).
      await apiPatch("/api/arena/match", { matchId: mId, action: "start" });

      // Move into prematch.
      setPhase("prematch");
    },
    [user?.id],
  );

  // Prematch auto-advance (2s for friend-challenge, 3s for sync; ghost duels
  // get a brief 2s reveal so the player can register the opponent).
  useEffect(() => {
    if (phase !== "prematch") return;
    const t = setTimeout(() => {
      // Reset battle state.
      setCurrentQ(0);
      setSelected(null);
      setAnswerResult(null);
      setMyHp(100);
      setOpHp(100);
      setMyCombo(0);
      setOpCombo(0);
      setGhostAnswerThisQ(null);
      answerLocked.current = false;
      if (questions[0]) setTimeLeft(questions[0].timeLimit);
      qStartedAt.current = Date.now();
      setPhase("battle");
    }, 2200);
    return () => clearTimeout(t);
  }, [phase, questions]);

  // ── Battle: question timer ─────────────────────────────────

  useEffect(() => {
    if (phase !== "battle" || answerResult !== null) return;
    const iv = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(iv);
          if (!answerLocked.current) void handleAnswer(-1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, currentQ, answerResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Battle: ghost replay poller ────────────────────────────
  // Every 250ms, ask /ghost-replay if the ghost has "answered" this question
  // at the current elapsedMs. When yes, apply opponent damage exactly once
  // per question.

  useEffect(() => {
    if (phase !== "battle" || !ghostId || ghostAnswerThisQ?.status === "answered" || ghostAnswerThisQ?.status === "skipped") return;

    const iv = setInterval(async () => {
      const elapsedMs = Date.now() - qStartedAt.current;
      const res = await apiGet<GhostReplayResponse>(
        `/api/arena/v2/ghost-replay?ghostId=${ghostId}&questionIndex=${currentQ}&elapsedMs=${elapsedMs}`,
      );
      if (!res.ok || !res.data) return;
      const data = res.data;
      if (data.status === "answered") {
        clearInterval(iv);
        setGhostAnswerThisQ(data);
        applyGhostDamage(data);
      } else if (data.status === "skipped") {
        clearInterval(iv);
        setGhostAnswerThisQ(data);
      }
    }, 250);

    return () => clearInterval(iv);
  }, [phase, ghostId, currentQ, ghostAnswerThisQ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Damage helpers ─────────────────────────────────────────

  function speedScalar(timeMs: number, timeLimitMs: number) {
    // 1.0x at full-time, 1.5x at instant.
    const remaining = Math.max(0, Math.min(timeLimitMs, timeLimitMs - timeMs));
    const pct = remaining / timeLimitMs;
    return 1 + (SPEED_BONUS_MAX - 1) * pct;
  }

  function comboMult(comboIdx: number) {
    return COMBO_STEPS[Math.min(comboIdx, COMBO_STEPS.length - 1)];
  }

  function comebackMult(qIdx: number) {
    return COMEBACK_QS.has(qIdx) ? COMEBACK_MULT : 1;
  }

  function applyGhostDamage(g: GhostReplayResponse) {
    if (!questions[currentQ]) return;
    const timeLimitMs = questions[currentQ].timeLimit * 1000;
    if (g.correct) {
      const damage = Math.round(
        BASE_DAMAGE *
          speedScalar(g.time_ms ?? timeLimitMs, timeLimitMs) *
          comboMult(opCombo) *
          comebackMult(currentQ),
      );
      setMyHp((h) => Math.max(0, h - damage));
      setMyFlash((f) => f + 1);
      setOpCombo((c) => Math.min(COMBO_CAP, c + 1));
    } else {
      // Ghost was wrong: self-damage to opponent.
      setOpHp((h) => Math.max(0, h - SELF_DAMAGE));
      setOpFlash((f) => f + 1);
      // Combo stalls on wrong (does NOT reset per spec).
    }
  }

  // ── Battle: submit my answer ───────────────────────────────

  const handleAnswer = useCallback(
    async (idx: number) => {
      if (answerLocked.current || !matchId || !user?.id || !questions[currentQ]) return;
      answerLocked.current = true;
      setSelected(idx);

      const responseTimeMs = Date.now() - qStartedAt.current;
      const apiRes = await apiPost<AnswerResult>("/api/arena/answer", {
        matchId,
        questionId: questions[currentQ].id,
        selectedAnswer: idx,
        responseTimeMs,
      });

      if (!apiRes.ok || !apiRes.data) {
        console.error("[arena/v2] answer", apiRes.error);
        answerLocked.current = false;
        return;
      }
      const result = apiRes.data;
      setAnswerResult(result);

      const timeLimitMs = questions[currentQ].timeLimit * 1000;
      if (result.isCorrect) {
        const damage = Math.round(
          BASE_DAMAGE *
            speedScalar(responseTimeMs, timeLimitMs) *
            comboMult(myCombo) *
            comebackMult(currentQ),
        );
        setOpHp((h) => Math.max(0, h - damage));
        setOpFlash((f) => f + 1);
        setMyCombo((c) => Math.min(COMBO_CAP, c + 1));
      } else {
        setMyHp((h) => Math.max(0, h - SELF_DAMAGE));
        setMyFlash((f) => f + 1);
        // Combo stalls.
      }

      // Advance after a brief reveal.
      setTimeout(() => {
        const nextQ = currentQ + 1;
        if (nextQ >= questions.length) {
          void completeMatch();
        } else {
          setCurrentQ(nextQ);
          setSelected(null);
          setAnswerResult(null);
          setGhostAnswerThisQ(null);
          answerLocked.current = false;
          setTimeLeft(questions[nextQ].timeLimit);
          qStartedAt.current = Date.now();
        }
      }, 1800);
    },
    [matchId, user?.id, questions, currentQ, myCombo], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Complete ───────────────────────────────────────────────

  const completeMatch = useCallback(async () => {
    if (!matchId) return;
    const res = await apiPost<CompleteResponse>("/api/arena/v2/complete", { matchId });
    if (res.ok && res.data) {
      setFinalResult(res.data);
    }
    setPhase("results");
    void refreshProfile();
  }, [matchId, refreshProfile]);

  // ── Render ─────────────────────────────────────────────────

  const opCurrentMult = comboMult(opCombo) * comebackMult(currentQ);

  return (
    <ProtectedRoute>
      <div data-force-dark className="relative min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden" style={{ isolation: "isolate" }}>
        {/* Atmospheric glows */}
        <div className="absolute top-[10%] left-[10%] w-[600px] h-[600px] rounded-full pointer-events-none opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }} />
        <div className="absolute top-[50%] right-[5%] w-[500px] h-[500px] rounded-full pointer-events-none opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #3B82F6 0%, transparent 70%)" }} />
        <div className="absolute bottom-[10%] left-[30%] w-[400px] h-[400px] rounded-full pointer-events-none opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #FFD700 0%, transparent 70%)" }} />

        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <BackButton />

          {/* ── LOBBY ─────────────────────────────────────── */}
          {phase === "lobby" && (
            <div className="animate-slide-up">
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full text-[11px] font-bebas tracking-[0.2em]"
                  style={{
                    background: "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(168,85,247,0.06) 100%)",
                    border: "1px solid rgba(168,85,247,0.35)",
                    color: "#C4B5FD",
                  }}>
                  ARENA V2 · ASYNC DUEL
                </div>
                <h1 className="font-bebas text-6xl sm:text-8xl tracking-wider leading-none mb-3 text-cream">
                  DUEL ARENA
                </h1>
                <p className="text-cream/40 text-sm sm:text-base max-w-md mx-auto font-syne">
                  Play live against a recorded run from a real player. Same 10 questions, same order. Skill is speed and accuracy together.
                </p>
              </div>

              {/* Ghost ELO claim card — renders only when buffer non-empty. */}
              <GhostEloCard />

              {/* Fangs balance + ELO */}
              <div className="flex items-center justify-center gap-6 mb-8">
                <div className="flex items-center gap-2">
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                  {profileLoading ? (
                    <span className="bg-white/10 rounded animate-pulse inline-block w-12 h-5" />
                  ) : (
                    <span className="font-bebas text-xl text-cream tracking-wider">{profile?.coins ?? 0}</span>
                  )}
                </div>
                <div className="w-px h-5 bg-white/10" />
                <div className="flex items-center gap-2">
                  <span className="text-cream/40 text-xs font-syne">ELO</span>
                  {profileLoading ? (
                    <span className="bg-white/10 rounded animate-pulse inline-block w-12 h-5" />
                  ) : (
                    <span className="font-bebas text-xl text-cream tracking-wider">{profile?.arena_elo ?? 1000}</span>
                  )}
                </div>
              </div>

              {/* Subject picker */}
              <div className="mb-7">
                <p className="font-bebas text-sm text-cream/50 tracking-[0.2em] mb-3">PICK SUBJECT</p>
                <div className="flex flex-wrap gap-2">
                  {SUBJECTS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSubject(s.id)}
                      className="px-4 py-2 rounded-full font-syne font-semibold text-sm transition-all duration-200 active:scale-95"
                      style={
                        subject === s.id
                          ? {
                              background: "linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(124,58,237,0.12) 100%)",
                              border: "1px solid rgba(168,85,247,0.6)",
                              color: "#E9D5FF",
                              boxShadow: "0 0 18px rgba(168,85,247,0.15), inset 0 1px 0 rgba(255,255,255,0.08)",
                            }
                          : {
                              background: "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.08)",
                              color: "rgba(238,244,255,0.55)",
                            }
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stake picker */}
              <div className="mb-7">
                <p className="font-bebas text-sm text-cream/50 tracking-[0.2em] mb-3">SET STAKE</p>
                <div className={`grid gap-3 ${allowedStakes.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
                  {allowedStakes.map((w) => (
                    <button
                      key={w}
                      onClick={() => setStake(w)}
                      className="relative rounded-xl py-3 sm:py-4 font-bebas text-xl sm:text-2xl tracking-wider transition-all duration-300 overflow-hidden"
                      style={
                        stake === w
                          ? {
                              background: "linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(184,150,12,0.08) 100%)",
                              border: "1px solid rgba(255,215,0,0.5)",
                              color: "#FFD700",
                              boxShadow: "0 0 25px rgba(255,215,0,0.15), inset 0 1px 0 rgba(255,215,0,0.15)",
                              transform: "scale(1.03)",
                            }
                          : {
                              background: "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.08)",
                              color: "rgba(238,244,255,0.4)",
                            }
                      }
                    >
                      <span className="relative flex items-center justify-center gap-1">
                        <img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" />
                        {w}
                      </span>
                    </button>
                  ))}
                </div>
                {profile && profile.coins < stake && (
                  <p className="text-red-400 text-xs text-center mt-3 font-semibold">
                    Not enough Fangs. You have {profile.coins}.
                  </p>
                )}
                {(profile?.arena_elo ?? 1000) < STAKE_HIGH_MIN_ELO && (
                  <p className="text-cream/30 text-[11px] text-center mt-3 font-syne italic">
                    250 stake unlocks at 1500 ELO.
                  </p>
                )}
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => startMatchmaking(false)}
                  disabled={!profile || profile.coins < stake}
                  className="flex-1 py-4 rounded-xl font-syne font-bold text-base sm:text-lg transition-all duration-300 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
                    color: "#04080F",
                    boxShadow: "0 4px 20px rgba(255,215,0,0.3), 0 1px 0 rgba(255,255,255,0.2) inset",
                  }}
                >
                  Find Opponent
                </button>
                <button
                  disabled
                  title="Challenge Friend ships in V2B"
                  className="flex-1 py-4 rounded-xl font-syne font-bold text-base sm:text-lg transition-all duration-300 disabled:opacity-40 cursor-not-allowed"
                  style={{
                    background: "rgba(168,85,247,0.06)",
                    border: "1px solid rgba(168,85,247,0.25)",
                    color: "rgba(196,181,253,0.7)",
                  }}
                >
                  Challenge Friend
                  <span className="block text-[10px] font-syne text-cream/30 mt-0.5 tracking-wider">SOON</span>
                </button>
              </div>
            </div>
          )}

          {/* ── SEARCHING SHIMMER ─────────────────────────── */}
          {phase === "searching" && (
            <div className="flex flex-col items-center justify-center py-24 animate-slide-up">
              <div className="relative mb-6">
                <motion.div
                  className="w-20 h-20 rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 70%)",
                    boxShadow: "0 0 60px rgba(168,85,247,0.4)",
                  }}
                  animate={reduced ? undefined : { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                  transition={reduced ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              <p className="font-bebas text-3xl text-cream tracking-wider mb-2">SEARCHING</p>
              <p className="text-cream/40 text-sm font-syne">
                Pulling a ghost from the last 24 hours
              </p>
              <p className="text-cream/25 text-xs font-syne mt-1">
                {Math.max(0, Math.floor((1500 - searchingMs) / 100) / 10).toFixed(1)}s
              </p>
            </div>
          )}

          {/* ── NO GHOST DEAD END ─────────────────────────── */}
          {phase === "no_ghost" && (
            <div className="max-w-md mx-auto text-center py-16 animate-slide-up">
              <div className="text-6xl mb-5" role="img" aria-label="quiet">
                {"\u{1F319}"}
              </div>
              <h2 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider mb-3">
                NO CHALLENGERS YET
              </h2>
              <p className="text-cream/55 text-sm font-syne leading-relaxed mb-7">
                No one has duelled this subject at your ELO recently. We will not fake an opponent. When a real run lands, we will let you know.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => setPhase("lobby")}
                  className="px-6 py-3 rounded-xl font-syne font-bold text-sm transition-all active:scale-95"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(238,244,255,0.75)",
                  }}
                >
                  Pick a different subject
                </button>
                {notifyOptedIn ? (
                  <span
                    className="px-6 py-3 rounded-xl font-syne font-bold text-sm flex items-center justify-center gap-2"
                    style={{
                      background: "rgba(34,197,94,0.1)",
                      border: "1px solid rgba(34,197,94,0.3)",
                      color: "#86EFAC",
                    }}
                  >
                    {"✓"} You will get a ping
                  </span>
                ) : (
                  <button
                    onClick={notifyMe}
                    className="px-6 py-3 rounded-xl font-syne font-bold text-sm transition-all active:scale-95"
                    style={{
                      background: "linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(124,58,237,0.1) 100%)",
                      border: "1px solid rgba(168,85,247,0.5)",
                      color: "#E9D5FF",
                    }}
                  >
                    Notify me
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── PRE MATCH ─────────────────────────────────── */}
          {phase === "prematch" && (
            <div className="flex flex-col items-center justify-center py-20 animate-slide-up">
              <p className="font-bebas text-sm text-cream/40 tracking-[0.3em] mb-6">YOUR OPPONENT</p>
              <GhostIdentity
                badge={isTrainerMatch ? "TRAINER" : isMismatched ? "MISMATCH" : "GHOST"}
                anonHandle={opponentAnonHandle}
                isTrainer={isTrainerMatch}
                ownerOptedIn={false}
                viewerIsAdult={viewerIsAdult}
                elo={opponentElo}
                align="left"
              />
              <p className="text-cream/40 text-xs font-syne mt-6">
                Stake locked: <span className="text-[#FFD700] font-bold">{effectiveStake} Fangs</span>
                {isMismatched && (
                  <span className="block text-amber-300/70 text-[10px] mt-0.5 italic">
                    Halved for ELO gap. Mismatched Duel.
                  </span>
                )}
              </p>
              <motion.div
                className="mt-8 h-1 rounded-full"
                style={{ background: "linear-gradient(90deg, #FFD700, #A855F7)", width: 200 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 2.0, ease: "linear" }}
              />
              <p className="text-cream/30 text-xs font-syne mt-4">Starting in 2 seconds</p>
            </div>
          )}

          {/* ── BATTLE ───────────────────────────────────── */}
          {phase === "battle" && questions[currentQ] && (
            <div className="animate-slide-up">
              {/* HP bars row */}
              <div className="grid grid-cols-2 gap-3 sm:gap-6 mb-4 sm:mb-6">
                <HpBar
                  hp={myHp}
                  label="You"
                  badge={myCombo > 0 ? `x${comboMult(myCombo)}` : undefined}
                  flashKey={myFlash}
                />
                <HpBar
                  hp={opHp}
                  label={isTrainerMatch ? "Trainer Ninny" : opponentAnonHandle}
                  reverse
                  badge={
                    isTrainerMatch
                      ? "TRAINER"
                      : opCombo > 0
                        ? `x${comboMult(opCombo)}`
                        : undefined
                  }
                  flashKey={opFlash}
                />
              </div>

              {/* Reactions + multiplier row */}
              <div className="flex items-center justify-between mb-5 px-1">
                <EmojiReaction hp={myHp} opponentHp={opHp} size="sm" />
                <div className="flex flex-col items-center gap-1">
                  <p className="font-bebas text-xs text-cream/40 tracking-[0.25em]">
                    Q{currentQ + 1} / {questions.length}
                  </p>
                  <div className="relative w-32 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <motion.div
                      className="absolute inset-y-0 left-0"
                      style={{
                        background: timeLeft <= 5 ? "#EF4444" : "#FFD700",
                        boxShadow: `0 0 8px ${timeLeft <= 5 ? "rgba(239,68,68,0.6)" : "rgba(255,215,0,0.5)"}`,
                      }}
                      initial={false}
                      animate={{ width: `${(timeLeft / (questions[currentQ].timeLimit || 15)) * 100}%` }}
                      transition={{ duration: reduced ? 0 : 0.3 }}
                    />
                  </div>
                  {COMEBACK_QS.has(currentQ) && (
                    <p className="font-bebas text-[10px] tracking-[0.2em] text-[#FFD700] mt-0.5">
                      COMEBACK ROUND · 1.5x
                    </p>
                  )}
                </div>
                <EmojiReaction hp={opHp} opponentHp={myHp} size="sm" />
              </div>

              {/* Question card */}
              <div
                className="rounded-2xl px-5 py-6 mb-4"
                style={{
                  background: "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.3)",
                  backdropFilter: "blur(12px)",
                }}
              >
                <p className="text-cream text-base sm:text-lg leading-relaxed font-syne">
                  {questions[currentQ].question}
                </p>
              </div>

              {/* Answer options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {questions[currentQ].options.map((opt, idx) => {
                  const isSelected = selected === idx;
                  const showFeedback = answerResult !== null;
                  const isMine = answerResult && isSelected;
                  const isCorrectAns = answerResult && idx === answerResult.correctAnswer;
                  const wasWrong = isMine && !answerResult.isCorrect;

                  return (
                    <button
                      key={idx}
                      onClick={() => handleAnswer(idx)}
                      disabled={selected !== null}
                      aria-pressed={isSelected}
                      className="text-left rounded-xl px-4 py-3.5 font-syne text-sm sm:text-base transition-all duration-200 active:scale-[0.98] disabled:cursor-default"
                      style={
                        showFeedback && isCorrectAns
                          ? {
                              background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(22,163,74,0.08) 100%)",
                              border: "1px solid rgba(34,197,94,0.55)",
                              color: "#86EFAC",
                              boxShadow: "0 0 18px rgba(34,197,94,0.15)",
                            }
                          : wasWrong
                            ? {
                                background: "linear-gradient(135deg, rgba(239,68,68,0.18) 0%, rgba(220,38,38,0.08) 100%)",
                                border: "1px solid rgba(239,68,68,0.5)",
                                color: "#FCA5A5",
                              }
                            : isSelected
                              ? {
                                  background: "rgba(168,85,247,0.12)",
                                  border: "1px solid rgba(168,85,247,0.5)",
                                  color: "#E9D5FF",
                                }
                              : {
                                  background: "rgba(255,255,255,0.03)",
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  color: "rgba(238,244,255,0.85)",
                                }
                      }
                    >
                      <span className="inline-flex items-baseline gap-2">
                        <span className="font-bebas tracking-wider text-xs opacity-70">{String.fromCharCode(65 + idx)}</span>
                        <span>{opt}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

            </div>
          )}

          {/* ── RESULTS ─────────────────────────────────── */}
          {phase === "results" && (
            <ResultsView
              result={finalResult}
              myUserId={user?.id}
              isTrainer={isTrainerMatch}
              myHp={myHp}
              opHp={opHp}
              opponentLabel={isTrainerMatch ? "Trainer Ninny" : opponentAnonHandle}
              effectiveStake={effectiveStake}
              isMismatched={isMismatched}
              opponentMultiplier={opCurrentMult}
              onReset={() => {
                setMatchId(null);
                setGhostId(null);
                setQuestions([]);
                setFinalResult(null);
                setPhase("lobby");
              }}
            />
          )}
        </div>

        {/* Consent modal lives at the page root so it overlays everything. */}
        <ConsentModal
          open={consentOpen}
          busy={consentBusy}
          onAccept={acceptConsent}
          onDecline={declineConsent}
        />

        {/* Battle-mode answer feedback flash */}
        <AnimatePresence>
          {phase === "battle" && answerResult && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-5 py-2.5 rounded-full font-bebas tracking-wider"
              style={{
                background: answerResult.isCorrect
                  ? "linear-gradient(135deg, rgba(34,197,94,0.95) 0%, rgba(22,163,74,0.85) 100%)"
                  : "linear-gradient(135deg, rgba(239,68,68,0.95) 0%, rgba(220,38,38,0.85) 100%)",
                color: "#04080F",
                boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
              }}
            >
              {answerResult.isCorrect ? "HIT" : "MISS"}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ProtectedRoute>
  );
}

// ── Results subcomponent ───────────────────────────────────

function ResultsView({
  result,
  myUserId,
  isTrainer,
  myHp,
  opHp,
  opponentLabel,
  effectiveStake,
  isMismatched,
  opponentMultiplier: _opMul,
  onReset,
}: {
  result: CompleteResponse | null;
  myUserId: string | undefined;
  isTrainer: boolean;
  myHp: number;
  opHp: number;
  opponentLabel: string;
  effectiveStake: number;
  isMismatched: boolean;
  opponentMultiplier: number;
  onReset: () => void;
}) {
  const youWin = result?.winnerId === myUserId;
  const isDraw = result?.winnerId == null;
  const status = youWin ? "VICTORY" : isDraw ? "DRAW" : "DEFEAT";

  const statusColor = youWin ? "#FFD700" : isDraw ? "#A855F7" : "#EF4444";

  return (
    <div className="max-w-md mx-auto text-center py-10 animate-slide-up">
      <p className="font-bebas text-sm text-cream/40 tracking-[0.3em] mb-3">
        {isTrainer ? "TRAINER DUEL" : "DUEL COMPLETE"}
      </p>
      <h1
        className="font-bebas text-6xl sm:text-7xl tracking-wider mb-6"
        style={{ color: statusColor, textShadow: `0 0 30px ${statusColor}55` }}
      >
        {status}
      </h1>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div
          className="rounded-xl py-4 px-3"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <p className="font-bebas text-xs text-cream/40 tracking-wider mb-1">YOU</p>
          <p className="font-bebas text-3xl text-cream">{myHp}</p>
          <p className="text-cream/35 text-[10px] font-syne">HP REMAINING</p>
        </div>
        <div
          className="rounded-xl py-4 px-3"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <p className="font-bebas text-xs text-cream/40 tracking-wider mb-1 truncate">{opponentLabel.toUpperCase()}</p>
          <p className="font-bebas text-3xl text-cream">{opHp}</p>
          <p className="text-cream/35 text-[10px] font-syne">HP REMAINING</p>
        </div>
      </div>

      {result && (
        <div className="mb-6 space-y-2">
          {result.isTrainerMatch ? (
            <p className="text-cream/55 text-xs sm:text-sm font-syne italic">
              Trainer duel. No Fangs at stake.
            </p>
          ) : (
            <p className="text-cream/70 text-sm font-syne flex items-center justify-center gap-2">
              <img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" />
              <span className={result.fangsDelta >= 0 ? "text-[#FFD700]" : "text-red-400"}>
                {result.fangsDelta >= 0 ? "+" : ""}
                {result.fangsDelta}
              </span>
              <span className="text-cream/40">
                {isMismatched ? `(${effectiveStake} after handicap)` : `(stake ${effectiveStake})`}
              </span>
            </p>
          )}
          <p className="text-cream/40 text-xs font-syne">
            New ELO: <span className="text-cream/70 font-bold">{result.newLiveElo}</span>
          </p>
          {result.capAlreadyReached && !result.isTrainerMatch && (
            <p className="text-amber-300/80 text-xs font-syne italic">
              Daily loss cap reached. No more Fangs deducted today.
            </p>
          )}
          {result.shakeItOffDispensed && (
            <p className="text-[#FFD700] text-xs font-syne">
              Shake-it-off bonus: <span className="font-bold">+25 Fangs</span>. We've all been there.
              {/* TODO Phase 2B: 3-loss intervention card + free Practice Duel button. */}
            </p>
          )}
        </div>
      )}

      <button
        onClick={onReset}
        className="px-6 py-3 rounded-xl font-syne font-bold text-sm transition-all active:scale-95"
        style={{
          background: "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
          color: "#04080F",
          boxShadow: "0 4px 20px rgba(255,215,0,0.3)",
        }}
      >
        Back to lobby
      </button>
    </div>
  );
}
