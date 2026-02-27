"use client";

import { useState, useEffect, useCallback } from "react";
import { User, Subject, Question } from "@/types";
import { SUBJECT_ICONS } from "@/lib/mockData";
import { createDuel, completeDuel, getQuestions } from "@/lib/db";
import DuelInvite from "@/components/DuelInvite";
import CoinAnimation from "@/components/CoinAnimation";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";

type DuelPhase = "invite" | "countdown" | "battle" | "results";

interface DuelScore {
  challenger: number;
  opponent: number;
}

interface AnswerRecord {
  challenger: boolean | null;
  opponent: boolean | null;
}

// Simulated opponent answers (random with bias toward 70% accuracy)
function simulateOpponentAnswer(correct: number, numOptions: number): boolean {
  return Math.random() < 0.68; // 68% accuracy for opponent
}

export default function DuelPage() {
  const [phase, setPhase] = useState<DuelPhase>("invite");
  const [opponent, setOpponent] = useState<User | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [duelId, setDuelId] = useState<string | null>(null);
  const { user, isLoading: authLoading, refreshUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [score, setScore] = useState<DuelScore>({ challenger: 0, opponent: 0 });
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15);
  const [countdown, setCountdown] = useState(3);
  const [showCoin, setShowCoin] = useState(false);
  const [opponentAnswering, setOpponentAnswering] = useState(false);

  // Countdown before battle
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("battle");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdown]);

  // Per-question timer
  useEffect(() => {
    if (phase !== "battle" || revealed) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleAnswer(-1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, revealed, currentQ]);

  const handleStartDuel = async (opp: User, sub: Subject): Promise<void> => {
    setOpponent(opp);
    setSubject(sub);
    // Fetch real questions from DB
    try {
      const dbQuestions = await getQuestions(sub);
      const mapped = dbQuestions.map(q => ({
        id: q.id,
        subject: q.subject as Subject,
        question: q.question,
        options: q.options,
        correctAnswer: q.correct_answer,
        difficulty: (q.difficulty === "beginner" ? "easy" : q.difficulty === "intermediate" ? "medium" : "hard") as import("@/types").Difficulty,
        coinReward: q.coin_reward,
        explanation: q.explanation ?? undefined,
      }));
      setQuestions(mapped);
    } catch {
      return; // Can't start duel without questions
    }
    setScore({ challenger: 0, opponent: 0 });
    setAnswers([]);
    setCurrentQ(0);
    setSelected(null);
    setRevealed(false);
    setTimeLeft(15);
    setCountdown(3);
    setPhase("countdown");

    // Create duel record in Supabase (best-effort)
    if (user) {
      try {
        const duel = await createDuel({
          challenger_id: user.id,
          opponent_id: opp.id,
          subject: sub,
          coins_wagered: 500,
        });
        if (duel && typeof duel === "object" && "id" in duel) setDuelId((duel as { id: string }).id);
      } catch { /* non-blocking */ }
    }
  };

  const handleAnswer = useCallback(
    (idx: number) => {
      if (revealed || !questions[currentQ]) return;
      setSelected(idx);
      setRevealed(true);
      setOpponentAnswering(true);

      const q = questions[currentQ];
      const myCorrect = idx === q.correctAnswer;
      const delay = 300 + Math.random() * 1500;

      // Simulate opponent answering
      setTimeout(() => {
        const oppCorrect = simulateOpponentAnswer(q.correctAnswer, q.options.length);
        setOpponentAnswering(false);

        if (myCorrect) setShowCoin(true);

        setScore((prev) => ({
          challenger: prev.challenger + (myCorrect ? 1 : 0),
          opponent: prev.opponent + (oppCorrect ? 1 : 0),
        }));

        setAnswers((prev) => [...prev, { challenger: myCorrect, opponent: oppCorrect }]);

        setTimeout(async () => {
          setShowCoin(false);
          if (currentQ + 1 >= questions.length) {
            // Save duel result to Supabase
            if (duelId && user && opponent) {
              const finalChallengerScore = score.challenger + (myCorrect ? 1 : 0);
              const finalOpponentScore = score.opponent + (oppCorrect ? 1 : 0);
              const winnerId = finalChallengerScore > finalOpponentScore ? user.id
                : finalOpponentScore > finalChallengerScore ? opponent.id : null;
              try {
                await completeDuel(duelId, {
                  challenger_score: finalChallengerScore,
                  opponent_score: finalOpponentScore,
                  winner_id: winnerId,
                  challenger_id: user.id,
                  opponent_id: opponent.id,
                  coins_wagered: 500,
                });
                await refreshUser();
              } catch { /* non-blocking */ }
            }
            setPhase("results");
          } else {
            setCurrentQ((prev) => prev + 1);
            setSelected(null);
            setRevealed(false);
            setTimeLeft(15);
          }
        }, 1500);
      }, delay);
    },
    [revealed, questions, currentQ, duelId, user, opponent, score, refreshUser]
  );

  const reset = () => {
    setPhase("invite");
    setOpponent(null);
    setSubject(null);
    setQuestions([]);
    setCurrentQ(0);
    setScore({ challenger: 0, opponent: 0 });
    setAnswers([]);
    setSelected(null);
    setRevealed(false);
    setTimeLeft(15);
    setCountdown(3);
  };

  const iWon = score.challenger > score.opponent;
  const isTie = score.challenger === score.opponent;

  if (authLoading || !user) return null;

  // ── Phase: Invite ──────────────────────────────────────────────────────────
  if (phase === "invite") {
    return (
      <div className="min-h-screen pt-20">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <BackButton />
          {/* Header */}
          <div className="text-center mb-12 animate-slide-up">
            <span className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/30
              rounded-full px-4 py-1.5 text-red-400 text-sm font-semibold mb-6">
              ⚔️ 1v1 Battle Mode
            </span>
            <h1 className="font-bebas text-6xl sm:text-8xl text-cream tracking-wider mb-4">
              DUEL ARENA
            </h1>
            <p className="text-cream/50 text-base max-w-xl mx-auto">
              Challenge another player. 10 questions. Winner takes 2× the coins.
              Real-time tracking — no hiding from your L.
            </p>
          </div>

          {/* Rules */}
          <div className="grid sm:grid-cols-3 gap-4 mb-10 animate-slide-up" style={{ animationDelay: "0.15s" }}>
            {[
              { icon: "⚡", label: "15 seconds", desc: "per question" },
              { icon: "🎯", label: "10 questions", desc: "same for both players" },
              { icon: "🪙", label: "2× coins", desc: "for the winner" },
            ].map((r) => (
              <div key={r.label} className="card text-center py-5">
                <span className="text-3xl block mb-2">{r.icon}</span>
                <p className="font-bebas text-xl text-cream tracking-wider">{r.label}</p>
                <p className="text-cream/40 text-sm">{r.desc}</p>
              </div>
            ))}
          </div>

          {/* Invite Card */}
          <div className="animate-slide-up" style={{ animationDelay: "0.25s" }}>
            <DuelInvite onStartDuel={handleStartDuel} />
          </div>
        </div>
      </div>
    );
  }

  // ── Phase: Countdown ───────────────────────────────────────────────────────
  if (phase === "countdown") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="flex items-center justify-center gap-8 mb-12">
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-electric mb-2">
                <img src={user?.avatar ?? ""} alt="You" className="w-full h-full object-cover bg-navy-50" />
              </div>
              <span className="font-bebas text-xl text-electric">You</span>
            </div>
            <div className="font-bebas text-5xl text-cream/30">VS</div>
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-red-400 mb-2">
                <img src={opponent?.avatar} alt={opponent?.username} className="w-full h-full object-cover bg-navy-50" />
              </div>
              <span className="font-bebas text-xl text-red-400">{opponent?.username}</span>
            </div>
          </div>

          <div
            className="font-bebas leading-none animate-score-pop mb-6"
            style={{
              fontSize: "12rem",
              color: countdown === 0 ? "#2ECC71" : "#4A90D9",
              textShadow: `0 0 40px ${countdown === 0 ? "#2ECC71" : "#4A90D9"}80`,
            }}
          >
            {countdown === 0 ? "GO!" : countdown}
          </div>

          <p className="font-bebas text-2xl text-cream/50 tracking-widest">
            {subject && SUBJECT_ICONS[subject]} {subject}
          </p>
        </div>
      </div>
    );
  }

  // ── Phase: Battle ──────────────────────────────────────────────────────────
  if (phase === "battle" && questions[currentQ]) {
    const q = questions[currentQ];
    const timerPct = (timeLeft / 15) * 100;
    const timerColor = timerPct > 50 ? "#4A90D9" : timerPct > 25 ? "#E67E22" : "#E74C3C";

    return (
      <div className="min-h-screen pt-20">
        <div className="max-w-4xl mx-auto px-4 py-6">

          {/* Scoreboard */}
          <div className="card mb-6 animate-slide-up">
            <div className="flex items-center justify-between">
              {/* You */}
              <div className="flex items-center gap-3 flex-1">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-electric flex-shrink-0">
                  <img src={user?.avatar ?? ""} alt="You" className="w-full h-full object-cover bg-navy-50" />
                </div>
                <div>
                  <p className="text-electric font-bold text-sm">You</p>
                  <p className="font-bebas text-3xl text-cream leading-none">{score.challenger}</p>
                </div>
              </div>

              {/* Center */}
              <div className="text-center flex-shrink-0 px-4">
                <p className="text-cream/30 text-xs font-semibold uppercase tracking-widest mb-1">
                  Q {currentQ + 1}/{questions.length}
                </p>
                <div
                  className="font-bebas text-5xl leading-none"
                  style={{ color: timerColor, textShadow: `0 0 15px ${timerColor}80` }}
                >
                  {timeLeft}
                </div>
                {/* Answer dots */}
                <div className="flex gap-1 justify-center mt-2">
                  {answers.map((a, i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full"
                      style={{
                        background: a.challenger ? "#2ECC71" : "#E74C3C",
                      }}
                    />
                  ))}
                  {Array.from({ length: questions.length - answers.length }).map((_, i) => (
                    <div key={`empty-${i}`} className="w-2 h-2 rounded-full bg-white/10" />
                  ))}
                </div>
              </div>

              {/* Opponent */}
              <div className="flex items-center gap-3 flex-1 justify-end">
                <div className="text-right">
                  <p className="text-red-400 font-bold text-sm">{opponent?.username}</p>
                  <p className="font-bebas text-3xl text-cream leading-none">{score.opponent}</p>
                </div>
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-red-400 flex-shrink-0">
                  <img src={opponent?.avatar} alt={opponent?.username ?? ""} className="w-full h-full object-cover bg-navy-50" />
                </div>
              </div>
            </div>

            {/* Timer bar */}
            <div className="w-full h-1.5 bg-white/10 rounded-full mt-4 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-linear"
                style={{
                  width: `${timerPct}%`,
                  background: timerColor,
                  boxShadow: `0 0 8px ${timerColor}80`,
                }}
              />
            </div>
          </div>

          {/* Coin Animation */}
          <div className="relative">
            <CoinAnimation trigger={showCoin} amount={q.coinReward} />
          </div>

          {/* Question */}
          <div className="card mb-6 relative">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border
                text-yellow-400 border-yellow-400/50 bg-yellow-400/10 capitalize">
                {q.difficulty}
              </span>
              <span className="text-cream/40 text-xs">+{q.coinReward} 🪙</span>
            </div>
            <p className="font-syne text-lg font-semibold text-cream text-center leading-relaxed">
              {q.question}
            </p>
          </div>

          {/* Opponent Status */}
          {opponentAnswering && !revealed && (
            <div className="flex items-center justify-end gap-2 mb-3 text-sm text-cream/40">
              <span className="animate-pulse">●●●</span>
              <span>{opponent?.username} is answering...</span>
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {q.options.map((opt, i) => {
              let cls =
                "w-full text-left px-5 py-4 rounded-xl border transition-all duration-200 font-semibold text-sm ";

              if (!revealed) {
                cls +=
                  "border-electric/20 bg-navy-50 hover:border-electric/60 hover:bg-electric/10 hover:-translate-y-0.5 cursor-pointer";
              } else if (i === q.correctAnswer) {
                cls += "border-green-400 bg-green-400/15 text-green-300";
              } else if (i === selected && i !== q.correctAnswer) {
                cls += "border-red-400 bg-red-400/15 text-red-300";
              } else {
                cls += "border-electric/10 bg-navy-50/50 text-cream/40 cursor-not-allowed";
              }

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={revealed}
                  className={cls}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center font-bebas text-sm flex-shrink-0
                        ${!revealed ? "bg-electric/20 text-electric" :
                          i === q.correctAnswer ? "bg-green-400/30 text-green-300" :
                          i === selected ? "bg-red-400/30 text-red-300" : "bg-white/5 text-cream/30"}`}
                    >
                      {revealed && i === q.correctAnswer ? "✓" :
                        revealed && i === selected ? "✗" : ["A", "B", "C", "D"][i]}
                    </span>
                    {opt}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Phase: Results ─────────────────────────────────────────────────────────
  if (phase === "results" && opponent) {
    const coinsEarned = iWon ? 750 : isTie ? 200 : 100;

    return (
      <div className="min-h-screen pt-20">
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          {/* Result */}
          <div className="mb-8 animate-slide-up">
            <div className="text-7xl mb-4">
              {isTie ? "🤝" : iWon ? "🏆" : "💀"}
            </div>
            <h1
              className="font-bebas text-7xl sm:text-8xl tracking-wider mb-2"
              style={{
                color: isTie ? "#E67E22" : iWon ? "#FFD700" : "#E74C3C",
                textShadow: `0 0 30px ${isTie ? "#E67E22" : iWon ? "#FFD700" : "#E74C3C"}60`,
              }}
            >
              {isTie ? "DRAW" : iWon ? "VICTORY" : "DEFEAT"}
            </h1>
            <p className="text-cream/50 text-base">
              {isTie
                ? "An even match — nobody gets bragging rights"
                : iWon
                ? `You outscored ${opponent.username}. Clean sweep.`
                : `${opponent.username} got you this time. Run it back?`}
            </p>
          </div>

          {/* Final Score */}
          <div
            className="flex items-center justify-center gap-8 mb-8 p-6 rounded-2xl animate-slide-up"
            style={{
              background: "linear-gradient(135deg, #0a1428, #060c18)",
              border: "1px solid #4A90D930",
              animationDelay: "0.1s",
            }}
          >
            <div className="text-center">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-electric mx-auto mb-2">
                <img src={user?.avatar ?? ""} alt="You" className="w-full h-full object-cover bg-navy-50" />
              </div>
              <p className="text-electric font-bold text-sm mb-1">You</p>
              <p
                className="font-bebas text-6xl leading-none"
                style={{
                  color: isTie ? "#E67E22" : iWon ? "#FFD700" : "#E74C3C",
                }}
              >
                {score.challenger}
              </p>
            </div>

            <div className="font-bebas text-4xl text-cream/30">—</div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-red-400 mx-auto mb-2">
                <img src={opponent.avatar} alt={opponent.username} className="w-full h-full object-cover bg-navy-50" />
              </div>
              <p className="text-red-400 font-bold text-sm mb-1">{opponent.username}</p>
              <p
                className="font-bebas text-6xl leading-none"
                style={{
                  color: isTie ? "#E67E22" : !iWon ? "#FFD700" : "#E74C3C",
                }}
              >
                {score.opponent}
              </p>
            </div>
          </div>

          {/* Answer comparison */}
          <div className="card mb-6 animate-slide-up text-left" style={{ animationDelay: "0.2s" }}>
            <h3 className="font-bebas text-xl text-cream tracking-wider mb-3">ROUND BY ROUND</h3>
            <div className="grid grid-cols-10 gap-1">
              {answers.map((a, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div
                    className="w-full h-6 rounded flex items-center justify-center text-xs font-bold"
                    style={{
                      background: a.challenger ? "#2ECC7125" : "#E74C3C25",
                      border: `1px solid ${a.challenger ? "#2ECC71" : "#E74C3C"}`,
                      color: a.challenger ? "#2ECC71" : "#E74C3C",
                    }}
                  >
                    {a.challenger ? "✓" : "✗"}
                  </div>
                  <div
                    className="w-full h-6 rounded flex items-center justify-center text-xs font-bold"
                    style={{
                      background: a.opponent ? "#4A90D925" : "#E74C3C25",
                      border: `1px solid ${a.opponent ? "#4A90D9" : "#E74C3C"}`,
                      color: a.opponent ? "#4A90D9" : "#E74C3C",
                    }}
                  >
                    {a.opponent ? "✓" : "✗"}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-cream/40">
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 rounded border border-green-400" />
                You
              </span>
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 rounded border border-electric" />
                {opponent.username}
              </span>
            </div>
          </div>

          {/* Coins earned */}
          <div
            className="flex items-center justify-center gap-3 p-4 rounded-xl mb-8 animate-slide-up"
            style={{
              background: "#FFD70010",
              border: "1px solid #FFD70030",
              animationDelay: "0.3s",
            }}
          >
            <span className="text-2xl">🪙</span>
            <span className="font-bebas text-3xl text-gold">{coinsEarned} coins earned</span>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 animate-slide-up" style={{ animationDelay: "0.4s" }}>
            <button onClick={reset} className="btn-gold flex-1 py-3">
              ⚔️ Rematch
            </button>
            <button onClick={reset} className="btn-outline flex-1 py-3">
              🔄 New Duel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
