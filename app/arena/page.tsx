"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/lib/auth";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { cdnUrl } from "@/lib/cdn";

// ── Types ────────────────────────────────────────────────────

type ArenaPhase = "lobby" | "matchmaking" | "challenge" | "prematch" | "battle" | "results";

interface ArenaPlayer {
  id: string;
  username: string;
  avatarUrl: string | null;
  elo: number;
}

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

interface MatchResult {
  winnerId: string | null;
  isDraw: boolean;
  player1: { points: number; correct: number; eloBefore: number; eloAfter: number; eloChange: number };
  player2: { points: number; correct: number; eloBefore: number; eloAfter: number; eloChange: number };
  wager: number;
}

interface QuestionRecord {
  myAnswer: number | null;
  myCorrect: boolean;
  myPoints: number;
  myTimeMs: number;
  opAnswer: number | null;
  opCorrect: boolean;
  opPoints: number;
  opTimeMs: number;
}

interface IncomingChallenge {
  id: string;
  challengerId: string;
  challengerName: string;
  challengerAvatar: string | null;
  challengerElo: number;
  wager: number;
  createdAt: string;
  expiresAt: string;
}

// ── Constants ────────────────────────────────────────────────

const WAGER_OPTIONS = [10, 25, 50, 100];

const ELO_TIERS = [
  { name: "Bronze", min: 0, max: 1199, color: "#CD7F32", icon: "🥉" },
  { name: "Silver", min: 1200, max: 1399, color: "#C0C0C0", icon: "🥈" },
  { name: "Gold", min: 1400, max: 1599, color: "#FFD700", icon: "🥇" },
  { name: "Platinum", min: 1600, max: 1799, color: "#00CED1", icon: "💎" },
  { name: "Diamond", min: 1800, max: 9999, color: "#B9F2FF", icon: "💠" },
];

function getEloTier(elo: number) {
  return ELO_TIERS.find(t => elo >= t.min && elo <= t.max) ?? ELO_TIERS[0];
}

// ── Component ────────────────────────────────────────────────

export default function ArenaPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { stats, mutate: mutateStats } = useUserStats(user?.id);

  // Phase state
  const [phase, setPhase] = useState<ArenaPhase>("lobby");
  const [wager, setWager] = useState(10);
  const [matchId, setMatchId] = useState<string | null>(null);

  // Player data
  const [me, setMe] = useState<ArenaPlayer | null>(null);
  const [opponent, setOpponent] = useState<ArenaPlayer | null>(null);
  const [myElo, setMyElo] = useState<number | null>(null);

  // Matchmaking
  const [searchTime, setSearchTime] = useState(0);
  const [eloRange, setEloRange] = useState(200);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Challenge
  const [challengeUsername, setChallengeUsername] = useState("");
  const [challengeError, setChallengeError] = useState("");
  const [challengeSent, setChallengeSent] = useState(false);
  const [incomingChallenges, setIncomingChallenges] = useState<IncomingChallenge[]>([]);

  // Battle
  const [questions, setQuestions] = useState<ArenaQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [timeLeft, setTimeLeft] = useState(15);
  const [selected, setSelected] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [opponentAnswered, setOpponentAnswered] = useState(false);
  const [questionRecords, setQuestionRecords] = useState<QuestionRecord[]>([]);
  const [myTotalPoints, setMyTotalPoints] = useState(0);
  const [opTotalPoints, setOpTotalPoints] = useState(0);
  const [myCorrectCount, setMyCorrectCount] = useState(0);
  const [opCorrectCount, setOpCorrectCount] = useState(0);
  const questionStartTime = useRef(0);
  const answerLocked = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Prematch countdown
  const [countdown, setCountdown] = useState(3);

  // Results
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  // Memoized avatar URLs
  const myAvatar = useMemo(() => {
    if (me?.avatarUrl) return me.avatarUrl;
    if (user?.avatar) return user.avatar;
    return `https://api.dicebear.com/7.x/adventurer/svg?seed=${user?.username ?? "player"}`;
  }, [me?.avatarUrl, user?.avatar, user?.username]);

  const opAvatar = useMemo(() => {
    if (!opponent) return "";
    return opponent.avatarUrl ?? `https://api.dicebear.com/7.x/adventurer/svg?seed=${opponent.username}`;
  }, [opponent]);

  // ── Load ELO on mount ──────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("arena_elo, username, avatar_url")
        .eq("id", user.id as string)
        .single();
      if (data) {
        setMyElo(data.arena_elo ?? 1000);
        setMe({
          id: user.id,
          username: data.username ?? user.username,
          avatarUrl: data.avatar_url,
          elo: data.arena_elo ?? 1000,
        });
      }
    })();
  }, [user?.id, user?.username]);

  // ── Poll for incoming challenges ───────────────────────────
  useEffect(() => {
    if (phase !== "lobby" || !user?.id) return;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`/api/arena/challenge?userId=${user.id}`);
        const data = await res.json();
        if (!cancelled) {
          setIncomingChallenges(data.challenges ?? []);
          if (data.acceptedChallenge?.matchId) {
            setMatchId(data.acceptedChallenge.matchId);
            loadMatch(data.acceptedChallenge.matchId);
          }
        }
      } catch { /* ignore */ }
    };

    check();
    const iv = setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [phase, user?.id]);

  // ── Matchmaking polling ────────────────────────────────────
  const startMatchmaking = useCallback(async () => {
    if (!user?.id) return;

    setPhase("matchmaking");
    setSearchTime(0);

    // Join queue
    await fetch("/api/arena/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, elo: myElo ?? 1000, wager }),
    });

    // Poll for match
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 2;
      setSearchTime(elapsed);

      try {
        const res = await fetch(`/api/arena/queue?userId=${user.id}`);
        const data = await res.json();

        if (data.eloRange) setEloRange(data.eloRange);

        if (data.status === "matched" && data.matchId) {
          if (pollRef.current) clearInterval(pollRef.current);
          setMatchId(data.matchId);
          loadMatch(data.matchId);
        }
      } catch { /* ignore */ }
    }, 2000);
  }, [user?.id, myElo, wager]);

  const cancelMatchmaking = useCallback(async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (user?.id) {
      await fetch(`/api/arena/queue?userId=${user.id}`, { method: "DELETE" });
    }
    setPhase("lobby");
    setSearchTime(0);
  }, [user?.id]);

  // ── Load match data ────────────────────────────────────────
  const loadMatch = useCallback(async (mId: string) => {
    try {
      const res = await fetch(`/api/arena/match?id=${mId}&userId=${user?.id}`);
      const data = await res.json();

      if (!data.match) return;

      setMatchId(mId);
      setQuestions(data.questions ?? []);

      const isP1 = data.match.player1_id === user?.id || data.player1?.id === user?.id;
      const meData = isP1 ? data.player1 : data.player2;
      const opData = isP1 ? data.player2 : data.player1;

      if (meData) setMe({ id: meData.id, username: meData.username, avatarUrl: meData.avatarUrl, elo: meData.elo });
      if (opData) setOpponent({ id: opData.id, username: opData.username, avatarUrl: opData.avatarUrl, elo: opData.elo });

      // Start prematch
      setPhase("prematch");
      setCountdown(3);

      // Mark match as active
      await fetch("/api/arena/match", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: mId, userId: user?.id, action: "start" }),
      });
    } catch (e) {
      console.error("Failed to load match:", e);
    }
  }, [user?.id]);

  // ── Prematch countdown ─────────────────────────────────────
  useEffect(() => {
    if (phase !== "prematch") return;
    if (countdown <= 0) {
      setPhase("battle");
      setCurrentQ(0);
      setSelected(null);
      setAnswerResult(null);
      setWaitingForOpponent(false);
      setOpponentAnswered(false);
      answerLocked.current = false;
      if (questions[0]) setTimeLeft(questions[0].timeLimit);
      questionStartTime.current = Date.now();
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown, questions]);

  // ── Realtime channel for opponent answers ──────────────────
  useEffect(() => {
    if (phase !== "battle" || !matchId || !opponent?.id) return;

    const channel = supabase.channel(`arena-match-${matchId}`);

    channel.on("broadcast", { event: "player_answered" }, (payload) => {
      if (payload.payload?.userId === opponent.id) {
        setOpponentAnswered(true);
      }
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [phase, matchId, opponent?.id]);

  // ── Question timer ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== "battle" || answerResult !== null) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          if (!answerLocked.current) handleAnswer(-1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, currentQ, answerResult]);

  // ── Submit answer ──────────────────────────────────────────
  const handleAnswer = useCallback(async (idx: number) => {
    if (answerLocked.current || !matchId || !user?.id || !questions[currentQ]) return;
    answerLocked.current = true;
    setSelected(idx);

    const responseTimeMs = Date.now() - questionStartTime.current;

    try {
      const res = await fetch("/api/arena/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId,
          questionId: questions[currentQ].id,
          userId: user.id,
          selectedAnswer: idx,
          responseTimeMs,
        }),
      });

      const result: AnswerResult = await res.json();
      setAnswerResult(result);

      // Update my running score
      setMyTotalPoints(p => p + result.pointsEarned);
      if (result.isCorrect) setMyCorrectCount(c => c + 1);

      // Broadcast that we answered
      channelRef.current?.send({
        type: "broadcast",
        event: "player_answered",
        payload: { userId: user.id, questionIndex: currentQ },
      });

      if (result.bothAnswered) {
        setOpponentAnswered(true);
        if (result.opponentAnswer) {
          setOpTotalPoints(p => p + result.opponentAnswer!.points_earned);
          if (result.opponentAnswer.is_correct) setOpCorrectCount(c => c + 1);
        }
        // Record and advance after brief delay
        recordAndAdvance(result, responseTimeMs);
      } else {
        setWaitingForOpponent(true);
        pollForOpponent(result, responseTimeMs);
      }
    } catch (e) {
      console.error("Answer submission error:", e);
      answerLocked.current = false;
    }
  }, [matchId, user?.id, questions, currentQ]);

  // Poll for opponent's answer if they haven't answered yet
  const pollForOpponent = useCallback(async (myResult: AnswerResult, myTimeMs: number) => {
    const maxPolls = 30; // 30s max wait
    let polls = 0;

    const iv = setInterval(async () => {
      polls++;
      if (polls > maxPolls) {
        clearInterval(iv);
        // Opponent timed out — record and advance
        recordAndAdvance(myResult, myTimeMs);
        return;
      }

      try {
        const res = await fetch(`/api/arena/match?id=${matchId}&userId=${user?.id}`);
        const data = await res.json();
        const qId = questions[currentQ]?.id;
        const answers = data.answers?.[qId];

        if (answers?.player1 && answers?.player2) {
          clearInterval(iv);
          const isP1 = me?.id === data.player1?.id;
          const opAns = isP1 ? answers.player2 : answers.player1;
          setOpponentAnswered(true);
          setOpTotalPoints(p => p + (opAns?.points_earned ?? 0));
          if (opAns?.is_correct) setOpCorrectCount(c => c + 1);
          recordAndAdvance(myResult, myTimeMs, opAns);
        }
      } catch { /* ignore */ }
    }, 1000);
  }, [matchId, user?.id, questions, currentQ, me?.id]);

  // Record question result and move to next
  const recordAndAdvance = useCallback((myResult: AnswerResult, myTimeMs: number, opAns?: { is_correct: boolean; points_earned: number; selected_answer: number; response_time_ms: number } | null) => {
    const opData = myResult.opponentAnswer ?? opAns;

    setQuestionRecords(prev => [
      ...prev,
      {
        myAnswer: selected,
        myCorrect: myResult.isCorrect,
        myPoints: myResult.pointsEarned,
        myTimeMs,
        opAnswer: opData?.selected_answer ?? null,
        opCorrect: opData?.is_correct ?? false,
        opPoints: opData?.points_earned ?? 0,
        opTimeMs: opData?.response_time_ms ?? 0,
      },
    ]);

    // Brief pause then advance
    setTimeout(() => {
      const nextQ = currentQ + 1;
      if (nextQ >= questions.length) {
        completeMatch();
      } else {
        setCurrentQ(nextQ);
        setSelected(null);
        setAnswerResult(null);
        setWaitingForOpponent(false);
        setOpponentAnswered(false);
        answerLocked.current = false;
        setTimeLeft(questions[nextQ].timeLimit);
        questionStartTime.current = Date.now();
      }
    }, 2200);
  }, [currentQ, questions, selected]);

  // ── Complete match ─────────────────────────────────────────
  const completeMatch = useCallback(async () => {
    try {
      const res = await fetch("/api/arena/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, userId: user?.id }),
      });
      const result = await res.json();
      setMatchResult(result);
      setPhase("results");

      // Refresh user stats (Fangs, etc.)
      if (user?.id) mutateUserStats(user.id);
      mutateStats?.();
    } catch (e) {
      console.error("Complete match error:", e);
      setPhase("results");
    }
  }, [matchId, user?.id, mutateStats]);

  // ── Challenge friend ───────────────────────────────────────
  const sendChallenge = useCallback(async () => {
    if (!user?.id || !challengeUsername.trim()) return;
    setChallengeError("");

    try {
      const res = await fetch("/api/arena/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengerId: user.id,
          challengedUsername: challengeUsername.trim(),
          wager,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setChallengeError(data.error);
      } else {
        setChallengeSent(true);
        // Poll for acceptance
        pollChallengeAccepted();
      }
    } catch {
      setChallengeError("Failed to send challenge");
    }
  }, [user?.id, challengeUsername, wager]);

  const pollChallengeAccepted = useCallback(() => {
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/arena/challenge?userId=${user?.id}`);
        const data = await res.json();
        if (data.acceptedChallenge?.matchId) {
          clearInterval(iv);
          setMatchId(data.acceptedChallenge.matchId);
          loadMatch(data.acceptedChallenge.matchId);
        }
      } catch { /* ignore */ }
    }, 2000);

    // Auto-cancel after 5 min
    setTimeout(() => {
      clearInterval(iv);
      if (phase === "challenge") {
        setChallengeError("Challenge expired");
        setChallengeSent(false);
      }
    }, 300000);
  }, [user?.id, phase, loadMatch]);

  const acceptChallenge = useCallback(async (challengeId: string) => {
    if (!user?.id) return;
    try {
      const res = await fetch("/api/arena/challenge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, userId: user.id, action: "accept" }),
      });
      const data = await res.json();
      if (data.matchId) {
        setMatchId(data.matchId);
        loadMatch(data.matchId);
      }
    } catch { /* ignore */ }
  }, [user?.id, loadMatch]);

  const declineChallenge = useCallback(async (challengeId: string) => {
    if (!user?.id) return;
    await fetch("/api/arena/challenge", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, userId: user.id, action: "decline" }),
    });
    setIncomingChallenges(prev => prev.filter(c => c.id !== challengeId));
  }, [user?.id]);

  // ── Reset ──────────────────────────────────────────────────
  const resetArena = useCallback(() => {
    setPhase("lobby");
    setMatchId(null);
    setOpponent(null);
    setQuestions([]);
    setCurrentQ(0);
    setSelected(null);
    setAnswerResult(null);
    setWaitingForOpponent(false);
    setOpponentAnswered(false);
    setQuestionRecords([]);
    setMyTotalPoints(0);
    setOpTotalPoints(0);
    setMyCorrectCount(0);
    setOpCorrectCount(0);
    setMatchResult(null);
    setCountdown(3);
    setSearchTime(0);
    setChallengeSent(false);
    setChallengeUsername("");
    setChallengeError("");
    answerLocked.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      channelRef.current?.unsubscribe();
    };
  }, []);

  const myTier = getEloTier(myElo ?? 1000);
  const opTier = opponent ? getEloTier(opponent.elo) : null;

  // ═══════════════════════════════════════════════════════════
  // PHASE: LOBBY
  // ═══════════════════════════════════════════════════════════
  if (phase === "lobby") {
    // Tier-specific glow configs for the rank badge
    const tierGlow = {
      Bronze:   { bg: "linear-gradient(135deg, #2a1a0a 0%, #1a0e04 100%)", shadow: "0 0 30px rgba(205,127,50,0.15), inset 0 1px 0 rgba(205,127,50,0.1)", accent: "rgba(205,127,50,0.25)" },
      Silver:   { bg: "linear-gradient(135deg, #1a1a22 0%, #10101a 100%)", shadow: "0 0 30px rgba(192,192,192,0.15), inset 0 1px 0 rgba(192,192,192,0.1)", accent: "rgba(192,192,192,0.25)" },
      Gold:     { bg: "linear-gradient(135deg, #1a1608 0%, #120e04 100%)", shadow: "0 0 30px rgba(255,215,0,0.2), inset 0 1px 0 rgba(255,215,0,0.1)", accent: "rgba(255,215,0,0.3)" },
      Platinum: { bg: "linear-gradient(135deg, #0a1a1a 0%, #041212 100%)", shadow: "0 0 30px rgba(0,206,209,0.15), inset 0 1px 0 rgba(0,206,209,0.1)", accent: "rgba(0,206,209,0.25)" },
      Diamond:  { bg: "linear-gradient(135deg, #0a1520 0%, #040a14 100%)", shadow: "0 0 30px rgba(185,242,255,0.2), inset 0 1px 0 rgba(185,242,255,0.15)", accent: "rgba(185,242,255,0.3)" },
    }[myTier.name] ?? { bg: "linear-gradient(135deg, #2a1a0a 0%, #1a0e04 100%)", shadow: "none", accent: "rgba(205,127,50,0.25)" };

    return (
      <ProtectedRoute>
        <div data-force-dark className="relative min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden" style={{ isolation: "isolate" }}>
          {/* Atmospheric glows — deep red combat + gold reward accents */}
          <div className="absolute top-[10%] left-[10%] w-[600px] h-[600px] rounded-full pointer-events-none opacity-[0.05]"
            style={{ background: "radial-gradient(circle, #EF4444 0%, transparent 70%)" }} />
          <div className="absolute top-[50%] right-[5%] w-[500px] h-[500px] rounded-full pointer-events-none opacity-[0.04]"
            style={{ background: "radial-gradient(circle, #DC2626 0%, transparent 70%)" }} />
          <div className="absolute bottom-[10%] left-[30%] w-[400px] h-[400px] rounded-full pointer-events-none opacity-[0.03]"
            style={{ background: "radial-gradient(circle, #FFD700 0%, transparent 70%)" }} />

          <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <BackButton />

            {/* ═══ TITLE — aggressive, epic ═══ */}
            <div className="text-center mb-10 animate-slide-up" style={{ animationDelay: "0s" }}>
              <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full text-sm font-bold tracking-wider"
                style={{
                  background: "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(220,38,38,0.06) 100%)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#EF4444",
                  boxShadow: "0 0 20px rgba(239,68,68,0.08)",
                }}>
                ⚔️ 1v1 BATTLE MODE
              </div>

              <h1 className="font-bebas text-7xl sm:text-9xl tracking-wider leading-none mb-3 arena-title-wave">
                DUEL ARENA
              </h1>

              <p className="text-cream/40 text-sm sm:text-base max-w-md mx-auto font-syne">
                Real-time 1v1 battles. Same questions, same timer. Winner takes the Fangs.
              </p>
            </div>

            {/* ═══ RANK BADGE — metallic, tier-colored ═══ */}
            <div className="animate-slide-up mb-10" style={{ animationDelay: "0.05s" }}>
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-4 px-8 py-4 rounded-2xl"
                  style={{
                    background: tierGlow.bg,
                    border: `1px solid ${tierGlow.accent}`,
                    boxShadow: tierGlow.shadow,
                  }}>
                  {/* Rank icon with glow ring */}
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center"
                      style={{
                        background: `radial-gradient(circle, ${myTier.color}20 0%, transparent 70%)`,
                        boxShadow: `0 0 20px ${myTier.color}15`,
                      }}>
                      <span className="text-3xl">{myTier.icon}</span>
                    </div>
                  </div>

                  {/* Rank name + ELO */}
                  <div>
                    <p className="font-bebas text-2xl sm:text-3xl tracking-[0.15em] leading-none"
                      style={{
                        color: myTier.color,
                        textShadow: `0 0 15px ${myTier.color}40`,
                      }}>
                      {myTier.name.toUpperCase()}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {myElo !== null ? (
                        <span className="font-bebas text-lg text-cream/60 tracking-wider">
                          {myElo} ELO
                        </span>
                      ) : (
                        <span className="bg-white/10 rounded animate-pulse inline-block w-16 h-5" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ WAGER SELECTION — premium golden glow ═══ */}
            <div className="animate-slide-up mb-8" style={{ animationDelay: "0.1s" }}>
              <p className="font-bebas text-lg text-cream/50 tracking-[0.2em] text-center mb-4">
                STAKE YOUR FANGS
              </p>
              <div className="grid grid-cols-4 gap-3">
                {WAGER_OPTIONS.map(w => (
                  <button
                    key={w}
                    onClick={() => setWager(w)}
                    className="relative rounded-xl py-4 font-bebas text-2xl tracking-wider transition-all duration-300 overflow-hidden"
                    style={wager === w ? {
                      background: "linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(184,150,12,0.08) 100%)",
                      border: "1px solid rgba(255,215,0,0.5)",
                      color: "#FFD700",
                      boxShadow: "0 0 25px rgba(255,215,0,0.15), inset 0 1px 0 rgba(255,215,0,0.15)",
                      transform: "scale(1.03)",
                    } : {
                      background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "rgba(238,244,255,0.4)",
                    }}
                  >
                    {/* Active glow sweep */}
                    {wager === w && (
                      <div className="absolute inset-0 pointer-events-none"
                        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255,215,0,0.1) 0%, transparent 70%)" }} />
                    )}
                    <div className="relative flex items-center justify-center gap-1.5">
                      <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                      {w}
                    </div>
                  </button>
                ))}
              </div>
              {stats && stats.coins < wager && (
                <p className="text-red-400 text-xs text-center mt-3 font-semibold">
                  Not enough Fangs. You have {stats.coins}.
                </p>
              )}
            </div>

            {/* ═══ ACTION BUTTONS — powerful, distinct ═══ */}
            <div className="animate-slide-up mb-10" style={{ animationDelay: "0.15s" }}>
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Find Opponent — primary, aggressive red-gold */}
                <button
                  onClick={startMatchmaking}
                  disabled={!stats || stats.coins < wager}
                  className="group relative flex-1 py-4 rounded-xl font-syne font-bold text-lg transition-all duration-300 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden"
                  style={{
                    background: "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
                    color: "#04080F",
                    boxShadow: "0 4px 20px rgba(255,215,0,0.3), 0 1px 0 rgba(255,255,255,0.2) inset",
                  }}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <span className="text-xl">⚔️</span> Find Opponent
                  </span>
                </button>

                {/* Challenge Friend — secondary, outlined with red accent */}
                <button
                  onClick={() => { setPhase("challenge"); setChallengeError(""); setChallengeSent(false); }}
                  disabled={!stats || stats.coins < wager}
                  className="group relative flex-1 py-4 rounded-xl font-syne font-bold text-lg transition-all duration-300 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: "linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.03) 100%)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    color: "#EF4444",
                    boxShadow: "0 0 15px rgba(239,68,68,0.06)",
                  }}
                >
                  <span className="flex items-center justify-center gap-2">
                    <span className="text-xl">👥</span> Challenge Friend
                  </span>
                </button>
              </div>
            </div>

            {/* ═══ INCOMING CHALLENGES ═══ */}
            {incomingChallenges.length > 0 && (
              <div className="animate-slide-up mb-10" style={{ animationDelay: "0.2s" }}>
                <p className="font-bebas text-lg text-cream/50 tracking-[0.15em] mb-3">
                  ⚔️ INCOMING CHALLENGES
                </p>
                <div className="space-y-3">
                  {incomingChallenges.map(c => (
                    <div key={c.id} className="rounded-xl p-4 flex items-center gap-4"
                      style={{
                        background: "linear-gradient(135deg, #1a0808 0%, #0d0404 100%)",
                        border: "1px solid rgba(239,68,68,0.2)",
                        boxShadow: "0 0 20px rgba(239,68,68,0.05)",
                      }}>
                      <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0"
                        style={{ border: "2px solid rgba(239,68,68,0.4)" }}>
                        <img src={c.challengerAvatar ?? `https://api.dicebear.com/7.x/adventurer/svg?seed=${c.challengerName}`}
                          alt={c.challengerName} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-cream font-bold text-sm truncate">{c.challengerName}</p>
                        <p className="text-cream/40 text-xs flex items-center gap-1">
                          {getEloTier(c.challengerElo).icon} {c.challengerElo} ELO
                          <span className="text-cream/15 mx-1">|</span>
                          <img src={cdnUrl("/F.png")} alt="" className="w-3 h-3 object-contain" /> {c.wager}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => acceptChallenge(c.id)}
                          className="font-bold text-sm px-4 py-2 rounded-lg transition-all duration-200 active:scale-95"
                          style={{
                            background: "linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%)",
                            border: "1px solid rgba(34,197,94,0.35)",
                            color: "#22C55E",
                          }}>
                          Accept
                        </button>
                        <button onClick={() => declineChallenge(c.id)}
                          className="text-cream/40 px-3 py-2 rounded-lg text-sm transition-all hover:text-cream/60"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}>
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ STAT CARDS — sleek with tier glow accents ═══ */}
            <div className="animate-slide-up" style={{ animationDelay: "0.25s" }}>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: "⏱️", label: "SMART TIMER", desc: "AI-judged per question", accent: "#4A90D9" },
                  { icon: "🎯", label: "10 QUESTIONS", desc: "Same for both players", accent: "#EF4444" },
                  { icon: "fang", label: "WINNER TAKES", desc: "Full wager from loser", accent: "#FFD700" },
                ].map(r => (
                  <div key={r.label} className="relative rounded-xl text-center p-4 sm:p-5 overflow-hidden group"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                    {/* Top accent line */}
                    <div className="absolute top-0 left-[20%] right-[20%] h-[1px]"
                      style={{ background: `linear-gradient(90deg, transparent, ${r.accent}30, transparent)` }} />

                    {r.icon === "fang"
                      ? <img src={cdnUrl("/F.png")} alt="Fangs" className="w-7 h-7 object-contain mx-auto mb-2.5" />
                      : <span className="text-2xl block mb-2.5">{r.icon}</span>
                    }
                    <p className="font-bebas text-sm sm:text-base tracking-wider mb-0.5" style={{ color: r.accent }}>
                      {r.label}
                    </p>
                    <p className="text-cream/25 text-[10px] sm:text-xs font-syne">{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE: CHALLENGE FRIEND
  // ═══════════════════════════════════════════════════════════
  if (phase === "challenge") {
    return (
      <ProtectedRoute>
        <div data-force-dark className="min-h-screen flex items-center justify-center px-4" style={{ isolation: "isolate" }}>
          <div className="max-w-md w-full animate-slide-up">
            <div className="rounded-2xl p-8"
              style={{
                background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)",
                border: "1px solid rgba(74,144,217,0.2)",
              }}>
              <h2 className="font-bebas text-3xl text-cream tracking-wider text-center mb-2">
                👥 CHALLENGE FRIEND
              </h2>
              <p className="text-cream/40 text-sm text-center mb-6">
                Enter their username to send a duel challenge
              </p>

              {!challengeSent ? (
                <>
                  <div className="mb-4">
                    <input
                      type="text"
                      value={challengeUsername}
                      onChange={e => setChallengeUsername(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendChallenge()}
                      placeholder="Enter username..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-cream placeholder:text-cream/25 focus:outline-none focus:border-electric/50 transition"
                    />
                  </div>

                  {challengeError && (
                    <p className="text-red-400 text-sm text-center mb-4">{challengeError}</p>
                  )}

                  <div className="flex items-center justify-center gap-2 mb-6 text-cream/40 text-sm">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />
                    <span>Wager: <span className="text-gold font-bold">{wager}</span> Fangs</span>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={sendChallenge}
                      disabled={!challengeUsername.trim()}
                      className="btn-gold flex-1 py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed">
                      Send Challenge
                    </button>
                    <button onClick={() => setPhase("lobby")}
                      className="btn-outline px-6 py-3 rounded-xl">
                      Back
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <div className="arena-search-pulse w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                    style={{ background: "rgba(74,144,217,0.1)", border: "2px solid rgba(74,144,217,0.3)" }}>
                    <span className="text-2xl">📨</span>
                  </div>
                  <p className="text-cream/60 text-sm mb-1">Challenge sent to</p>
                  <p className="text-electric font-bold text-lg mb-4">{challengeUsername}</p>
                  <p className="text-cream/30 text-xs mb-6">Waiting for them to accept...</p>
                  <button onClick={() => { setChallengeSent(false); setPhase("lobby"); }}
                    className="btn-outline px-6 py-3 rounded-xl">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE: MATCHMAKING
  // ═══════════════════════════════════════════════════════════
  if (phase === "matchmaking") {
    return (
      <ProtectedRoute>
        <div data-force-dark className="min-h-screen flex items-center justify-center px-4" style={{ isolation: "isolate" }}>
          <div className="text-center max-w-md w-full animate-slide-up">
            {/* Searching animation */}
            <div className="relative w-32 h-32 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full arena-search-ring" />
              <div className="absolute inset-3 rounded-full arena-search-ring" style={{ animationDelay: "0.5s", animationDuration: "2.5s" }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-5xl">⚔️</span>
              </div>
            </div>

            <h2 className="font-bebas text-4xl text-cream tracking-wider mb-2">
              SEARCHING FOR OPPONENT
            </h2>
            <p className="text-cream/40 text-sm mb-6">
              Finding a player within {eloRange} ELO of you...
            </p>

            {/* Timer */}
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="font-bebas text-5xl text-electric">{searchTime}s</div>
            </div>

            {/* Wager display */}
            <div className="flex items-center justify-center gap-2 mb-8 text-cream/40 text-sm">
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />
              <span>{wager} Fangs wagered</span>
            </div>

            {searchTime > 30 && (
              <p className="text-yellow-400/60 text-xs mb-4 animate-pulse">
                Expanding search range...
              </p>
            )}

            <button onClick={cancelMatchmaking}
              className="btn-outline px-8 py-3 rounded-xl">
              Cancel Search
            </button>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE: PRE-MATCH
  // ═══════════════════════════════════════════════════════════
  if (phase === "prematch") {
    return (
      <ProtectedRoute>
        <div data-force-dark className="min-h-screen flex items-center justify-center px-4" style={{ isolation: "isolate" }}>
          <div className="text-center">
            {/* Player Cards */}
            <div className="flex items-center justify-center gap-6 sm:gap-12 mb-10 animate-slide-up">
              {/* Me */}
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden mb-3"
                  style={{ border: `3px solid ${myTier.color}` }}>
                  <img src={myAvatar} alt="You" className="w-full h-full object-cover" />
                </div>
                <p className="font-bold text-cream text-sm sm:text-base mb-1">{me?.username ?? "You"}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{myTier.icon}</span>
                  <span className="font-bebas text-sm" style={{ color: myTier.color }}>{myElo}</span>
                </div>
              </div>

              {/* VS */}
              <div className="flex flex-col items-center">
                <div className="font-bebas text-5xl sm:text-6xl text-cream/20 leading-none mb-2">VS</div>
                <div className="flex items-center gap-1.5 text-cream/30 text-xs">
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />
                  <span>{wager}</span>
                </div>
              </div>

              {/* Opponent */}
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden mb-3"
                  style={{ border: `3px solid ${opTier?.color ?? "#EF4444"}` }}>
                  <img src={opAvatar} alt={opponent?.username ?? "Opponent"} className="w-full h-full object-cover" />
                </div>
                <p className="font-bold text-cream text-sm sm:text-base mb-1">{opponent?.username ?? "Opponent"}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{opTier?.icon}</span>
                  <span className="font-bebas text-sm" style={{ color: opTier?.color }}>{opponent?.elo}</span>
                </div>
              </div>
            </div>

            {/* Countdown */}
            <div
              className="font-bebas leading-none arena-countdown-pop mb-6"
              style={{
                fontSize: "10rem",
                color: countdown === 0 ? "#2ECC71" : "#EF4444",
                textShadow: `0 0 60px ${countdown === 0 ? "#2ECC71" : "#EF4444"}60`,
              }}
            >
              {countdown === 0 ? "GO!" : countdown}
            </div>

            <p className="font-bebas text-2xl text-cream/40 tracking-widest animate-slide-up">
              BATTLE STARTING
            </p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE: BATTLE
  // ═══════════════════════════════════════════════════════════
  if (phase === "battle" && questions[currentQ]) {
    const q = questions[currentQ];
    const totalTime = q.timeLimit;
    const timerPct = (timeLeft / totalTime) * 100;
    const timerColor = timerPct > 50 ? "#4A90D9" : timerPct > 25 ? "#E67E22" : "#E74C3C";
    const timerStroke = 2 * Math.PI * 44;
    const timerOffset = timerStroke * (1 - timerPct / 100);

    return (
      <ProtectedRoute>
        <div data-force-dark className="min-h-screen pt-16 pb-6" style={{ isolation: "isolate" }}>
          <div className="max-w-3xl mx-auto px-4 py-4">

            {/* Scoreboard */}
            <div className="rounded-2xl p-4 mb-5 animate-slide-up"
              style={{
                background: "linear-gradient(135deg, #0a1428 0%, #060c18 100%)",
                border: "1px solid rgba(74,144,217,0.15)",
              }}>
              <div className="flex items-center justify-between">
                {/* Me */}
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
                    style={{ border: `2px solid ${myTier.color}` }}>
                    <img src={myAvatar} alt="You" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="text-electric font-bold text-xs">{me?.username ?? "You"}</p>
                    <p className="font-bebas text-2xl text-cream leading-none">{myTotalPoints}</p>
                  </div>
                </div>

                {/* Center: Timer ring */}
                <div className="relative flex-shrink-0 mx-3">
                  <svg width="96" height="96" viewBox="0 0 96 96" className="arena-timer-ring">
                    {/* Background ring */}
                    <circle cx="48" cy="48" r="44" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                    {/* Timer arc */}
                    <circle
                      cx="48" cy="48" r="44"
                      fill="none"
                      stroke={timerColor}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={timerStroke}
                      strokeDashoffset={timerOffset}
                      transform="rotate(-90 48 48)"
                      style={{ transition: "stroke-dashoffset 1s linear, stroke 0.3s" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-cream/30 text-[9px] font-bold uppercase tracking-widest">
                      Q{currentQ + 1}/{questions.length}
                    </p>
                    <p className="font-bebas text-3xl leading-none" style={{ color: timerColor }}>
                      {timeLeft}
                    </p>
                  </div>
                </div>

                {/* Opponent */}
                <div className="flex items-center gap-3 flex-1 justify-end">
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <p className="text-red-400 font-bold text-xs">{opponent?.username ?? "Opponent"}</p>
                      {answerResult && !answerResult.bothAnswered && !opponentAnswered && (
                        <span className="text-cream/30 text-[10px] animate-pulse">thinking...</span>
                      )}
                      {opponentAnswered && answerResult && (
                        <span className="text-green-400 text-[10px]">answered</span>
                      )}
                    </div>
                    <p className="font-bebas text-2xl text-cream leading-none">{opTotalPoints}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
                    style={{ border: `2px solid ${opTier?.color ?? "#EF4444"}` }}>
                    <img src={opAvatar} alt={opponent?.username ?? ""} className="w-full h-full object-cover" />
                  </div>
                </div>
              </div>

              {/* Progress dots */}
              <div className="flex gap-1.5 justify-center mt-3">
                {questionRecords.map((r, i) => (
                  <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: r.myCorrect ? "#2ECC71" : "#E74C3C" }} />
                ))}
                {currentQ < questions.length && (
                  <div className="w-2.5 h-2.5 rounded-full ring-2 ring-electric/50 bg-electric/20" />
                )}
                {Array.from({ length: Math.max(0, questions.length - questionRecords.length - 1) }).map((_, i) => (
                  <div key={`e-${i}`} className="w-2.5 h-2.5 rounded-full bg-white/10" />
                ))}
              </div>
            </div>

            {/* Question Card */}
            <div className="rounded-2xl p-6 mb-5"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border
                  ${q.difficulty === "beginner" ? "text-green-400 border-green-400/30 bg-green-400/10" :
                    q.difficulty === "advanced" ? "text-red-400 border-red-400/30 bg-red-400/10" :
                    "text-yellow-400 border-yellow-400/30 bg-yellow-400/10"}`}>
                  {q.difficulty}
                </span>
                <span className="text-cream/25 text-[10px] uppercase tracking-wider">{q.cognitiveLoad}</span>
              </div>
              <p className="font-syne text-lg font-semibold text-cream text-center leading-relaxed">
                {q.question}
              </p>
            </div>

            {/* Answer feedback */}
            {answerResult && (
              <div className={`text-center mb-4 font-bebas text-xl tracking-wider arena-answer-pop
                ${answerResult.isCorrect ? "text-green-400" : "text-red-400"}`}>
                {answerResult.isCorrect
                  ? `✓ CORRECT! +${answerResult.pointsEarned} pts`
                  : "✗ WRONG"}
                {waitingForOpponent && !opponentAnswered && (
                  <span className="block text-cream/30 text-sm font-syne font-normal mt-1 animate-pulse">
                    Waiting for opponent...
                  </span>
                )}
              </div>
            )}

            {/* Answer Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {q.options.map((opt, i) => {
                let cls = "w-full text-left px-5 py-4 rounded-xl border transition-all duration-200 font-semibold text-sm ";

                if (!answerResult) {
                  cls += "border-electric/20 bg-[#0a0e18] hover:border-electric/50 hover:bg-electric/10 cursor-pointer";
                } else if (i === answerResult.correctAnswer) {
                  cls += "border-green-400 bg-green-400/15 text-green-300";
                } else if (i === selected && !answerResult.isCorrect) {
                  cls += "border-red-400 bg-red-400/15 text-red-300";
                } else {
                  cls += "border-white/5 bg-white/[0.02] text-cream/30";
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(i)}
                    disabled={!!answerResult}
                    className={cls}
                  >
                    <span className="flex items-center gap-3">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-bebas text-sm flex-shrink-0
                        ${!answerResult ? "bg-electric/20 text-electric" :
                          i === answerResult.correctAnswer ? "bg-green-400/30 text-green-300" :
                          i === selected && !answerResult.isCorrect ? "bg-red-400/30 text-red-300" :
                          "bg-white/5 text-cream/20"}`}>
                        {answerResult && i === answerResult.correctAnswer ? "✓" :
                          answerResult && i === selected && !answerResult.isCorrect ? "✗" :
                          ["A", "B", "C", "D"][i]}
                      </span>
                      {opt}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE: RESULTS
  // ═══════════════════════════════════════════════════════════
  if (phase === "results") {
    const iAmP1 = matchResult ? (me?.id === undefined ? true : true) : true;
    const myRes = matchResult
      ? (matchResult.winnerId === null
        ? matchResult.player1 // draw, pick either
        : matchResult.player1) // we need to figure out which one is us
      : null;
    const opRes = matchResult
      ? (matchResult.winnerId === null
        ? matchResult.player2
        : matchResult.player2)
      : null;

    // Determine if I won based on the match result
    const iWon = matchResult ? matchResult.winnerId === me?.id : myTotalPoints > opTotalPoints;
    const isDraw = matchResult ? matchResult.isDraw : myTotalPoints === opTotalPoints;

    // Figure out which player is me in the result
    // The match API returns player1 and player2 in order. We know if we're player1 or player2.
    // For simplicity, use our running tallies which are accurate.
    const myEloChange = matchResult
      ? (iWon ? Math.abs(matchResult.player1.eloChange) : isDraw ? 0 : -Math.abs(matchResult.player1.eloChange))
      : 0;

    // Best effort ELO change — use whichever player has positive change if we won
    let displayEloChange = 0;
    if (matchResult) {
      if (iWon) {
        displayEloChange = matchResult.player1.eloChange > 0 ? matchResult.player1.eloChange : matchResult.player2.eloChange;
      } else if (isDraw) {
        displayEloChange = 0;
      } else {
        displayEloChange = matchResult.player1.eloChange < 0 ? matchResult.player1.eloChange : matchResult.player2.eloChange;
      }
    }

    return (
      <ProtectedRoute>
        <div data-force-dark className="min-h-screen pt-16 pb-20" style={{ isolation: "isolate" }}>
          <div className="max-w-2xl mx-auto px-4 py-8 text-center">

            {/* Result Banner */}
            <div className="mb-8 animate-slide-up">
              <div className="text-7xl mb-4">
                {isDraw ? "🤝" : iWon ? "🏆" : "💀"}
              </div>
              <h1 className="font-bebas text-7xl sm:text-8xl tracking-wider mb-2"
                style={{
                  color: isDraw ? "#E67E22" : iWon ? "#FFD700" : "#E74C3C",
                  textShadow: `0 0 40px ${isDraw ? "#E67E22" : iWon ? "#FFD700" : "#E74C3C"}50`,
                }}>
                {isDraw ? "DRAW" : iWon ? "VICTORY" : "DEFEAT"}
              </h1>
              <p className="text-cream/50 text-base">
                {isDraw
                  ? "An even match — each player keeps their Fangs"
                  : iWon
                  ? `You dominated ${opponent?.username ?? "your opponent"}!`
                  : `${opponent?.username ?? "Your opponent"} got you this time.`}
              </p>
            </div>

            {/* Score Display */}
            <div className="rounded-2xl p-6 mb-6 animate-slide-up"
              style={{
                background: "linear-gradient(135deg, #0a1428 0%, #060c18 100%)",
                border: "1px solid rgba(74,144,217,0.15)",
                animationDelay: "0.1s",
              }}>
              <div className="flex items-center justify-center gap-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full overflow-hidden mx-auto mb-2"
                    style={{ border: `3px solid ${iWon || isDraw ? "#FFD700" : "#E74C3C"}` }}>
                    <img src={myAvatar} alt="You" className="w-full h-full object-cover" />
                  </div>
                  <p className="text-electric font-bold text-sm mb-1">{me?.username ?? "You"}</p>
                  <p className="font-bebas text-5xl leading-none"
                    style={{ color: iWon ? "#FFD700" : isDraw ? "#E67E22" : "#E74C3C" }}>
                    {myTotalPoints}
                  </p>
                  <p className="text-cream/30 text-xs mt-1">{myCorrectCount}/10 correct</p>
                </div>

                <div className="font-bebas text-4xl text-cream/20">—</div>

                <div className="text-center">
                  <div className="w-16 h-16 rounded-full overflow-hidden mx-auto mb-2"
                    style={{ border: `3px solid ${!iWon && !isDraw ? "#FFD700" : "#E74C3C"}` }}>
                    <img src={opAvatar} alt={opponent?.username ?? ""} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-red-400 font-bold text-sm mb-1">{opponent?.username ?? "Opponent"}</p>
                  <p className="font-bebas text-5xl leading-none"
                    style={{ color: !iWon && !isDraw ? "#FFD700" : isDraw ? "#E67E22" : "#E74C3C" }}>
                    {opTotalPoints}
                  </p>
                  <p className="text-cream/30 text-xs mt-1">{opCorrectCount}/10 correct</p>
                </div>
              </div>
            </div>

            {/* Fang Transfer */}
            <div className="rounded-xl p-4 mb-6 animate-slide-up flex items-center justify-center gap-3"
              style={{
                background: iWon ? "rgba(255,215,0,0.08)" : isDraw ? "rgba(230,126,34,0.08)" : "rgba(231,76,60,0.08)",
                border: `1px solid ${iWon ? "#FFD70030" : isDraw ? "#E67E2230" : "#E74C3C30"}`,
                animationDelay: "0.15s",
              }}>
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-7 h-7 object-contain" />
              <span className="font-bebas text-2xl" style={{ color: iWon ? "#FFD700" : isDraw ? "#E67E22" : "#E74C3C" }}>
                {iWon ? `+${matchResult?.wager ?? wager}` : isDraw ? "±0" : `-${matchResult?.wager ?? wager}`} FANGS
              </span>
            </div>

            {/* ELO Change */}
            <div className="rounded-xl p-4 mb-6 animate-slide-up"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                animationDelay: "0.2s",
              }}>
              <div className="flex items-center justify-center gap-4">
                <span className="text-cream/40 text-sm">ELO</span>
                <span className="font-bebas text-2xl" style={{
                  color: displayEloChange > 0 ? "#2ECC71" : displayEloChange < 0 ? "#E74C3C" : "#E67E22"
                }}>
                  {displayEloChange > 0 ? "+" : ""}{displayEloChange}
                </span>
              </div>
            </div>

            {/* Question Breakdown */}
            <div className="rounded-2xl p-5 mb-6 text-left animate-slide-up"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                animationDelay: "0.25s",
              }}>
              <h3 className="font-bebas text-lg text-cream tracking-wider mb-3">ROUND BY ROUND</h3>
              <div className="space-y-2">
                {questionRecords.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="text-cream/30 font-bebas w-6 text-right">Q{i + 1}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <div className={`flex items-center gap-1 px-2 py-1 rounded ${r.myCorrect ? "bg-green-400/10 text-green-400" : "bg-red-400/10 text-red-400"}`}>
                        {r.myCorrect ? "✓" : "✗"} <span className="text-cream/30">+{r.myPoints}</span>
                      </div>
                      <span className="text-cream/20">vs</span>
                      <div className={`flex items-center gap-1 px-2 py-1 rounded ${r.opCorrect ? "bg-blue-400/10 text-blue-400" : "bg-red-400/10 text-red-400"}`}>
                        {r.opCorrect ? "✓" : "✗"} <span className="text-cream/30">+{r.opPoints}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/5 text-[10px] text-cream/30">
                <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-green-400/30" /> You</span>
                <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-blue-400/30" /> {opponent?.username}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 animate-slide-up" style={{ animationDelay: "0.3s" }}>
              <button onClick={() => { resetArena(); startMatchmaking(); }}
                className="btn-gold flex-1 py-3 rounded-xl">
                🎯 Find New Opponent
              </button>
              <button onClick={resetArena}
                className="btn-outline flex-1 py-3 rounded-xl">
                ← Back to Arena
              </button>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Fallback
  return null;
}
