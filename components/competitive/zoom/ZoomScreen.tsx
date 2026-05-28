"use client";

// Zoom Reveal — image un-blurs over ~15s; guess early to score more; a wrong
// guess locks the round. Both players see the same images. Fuzzy match via the
// shared Levenshtein matcher. Settles via the shared /complete endpoint.

import { useState, useEffect, useRef, useCallback } from "react";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import { useSettle } from "../useSettle";
import ResultCard from "../ResultCard";
import { compareGuess } from "@/lib/party/levenshtein";
import { scoreZoom } from "@/lib/competitive/scoring";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

interface Round {
  id: string;
  round_num: number;
  image_url: string;
  answer: string;
  aliases: string[];
  reveal_sec: number;
}

export default function ZoomScreen({ loaded, selfId }: { loaded: LoadedMatch; selfId: string }) {
  const matchId = loaded.match.id;
  const rounds = loaded.rounds as unknown as Round[];
  const { on, send } = useMatchChannel(matchId, selfId);
  const { settle, result } = useSettle(matchId);

  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [guess, setGuess] = useState("");
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<"" | "correct" | "wrong" | "close">("");
  const [roundStart, setRoundStart] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const [imgError, setImgError] = useState(false);
  const myScoreRef = useRef(0);

  const round = rounds[idx];
  const revealMs = (round?.reveal_sec ?? 15) * 1000;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const off = on(COMPETITIVE_EVENTS.PROGRESS, (p) => {
      if (typeof p.score === "number") setOppScore(p.score as number);
    });
    const offFin = on(COMPETITIVE_EVENTS.FINISHED, () => {});
    return () => { off(); offFin(); };
  }, [on]);

  const elapsed = now - roundStart;
  const blurAmount = Math.max(0, 28 * (1 - Math.min(1, elapsed / revealMs)));

  const advance = useCallback(() => {
    setGuess(""); setLocked(false); setFeedback(""); setImgError(false);
    if (idx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: COMPETITIVE_EVENTS.FINISHED });
      return;
    }
    setIdx((i) => i + 1);
    setRoundStart(Date.now());
  }, [idx, rounds.length, send]);

  const submitGuess = useCallback(() => {
    if (locked || !guess.trim() || finished) return;
    const verdict = compareGuess(guess, round.answer);
    const aliasHit = round.aliases.some((a) => compareGuess(guess, a) === "correct");
    if (verdict === "correct" || aliasHit) {
      const pts = scoreZoom({ elapsedMs: elapsed, revealMs });
      setScore((s) => { myScoreRef.current = s + pts; return s + pts; });
      setFeedback("correct");
      send({ type: COMPETITIVE_EVENTS.PROGRESS, score: myScoreRef.current });
      setTimeout(advance, 1300);
    } else {
      setLocked(true);
      setFeedback(verdict === "close" ? "close" : "wrong");
      setTimeout(advance, 1500);
    }
  }, [locked, guess, round, elapsed, revealMs, send, advance, finished]);

  // round timeout
  useEffect(() => {
    if (locked || finished || feedback) return;
    if (elapsed > revealMs + 2000) advance();
  }, [elapsed, revealMs, locked, finished, feedback, advance]);

  useEffect(() => {
    if (!finished) return;
    const map: Record<string, number> = {};
    const myTeam = loaded.match.team_a.includes(selfId) ? loaded.match.team_a : loaded.match.team_b;
    const otherTeam = loaded.match.team_a.includes(selfId) ? loaded.match.team_b : loaded.match.team_a;
    myTeam.forEach((u) => (map[u] = myScoreRef.current));
    otherTeam.forEach((u) => (map[u] = oppScore));
    settle(map);
  }, [finished, settle, loaded.match, selfId, oppScore]);

  if (result) return <ResultCard result={result} selfId={selfId} teamA={loaded.match.team_a} />;
  if (finished) return <SettlingMsg />;
  if (!round) return <p className="text-cream/60 text-center py-20">No rounds loaded.</p>;

  return (
    <div>
      <Hud idx={idx} total={rounds.length} score={score} oppScore={oppScore} accent="#00BFFF" />
      <div className="relative rounded-2xl overflow-hidden mb-5 aspect-video bg-black/40"
        style={{ border: "1px solid rgba(0,191,255,0.25)" }}>
        {!imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={round.image_url}
            alt="Guess this"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-[filter] duration-200"
            style={{ filter: `blur(${blurAmount}px)`, transform: "scale(1.1)" }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <button onClick={advance} className="font-bebas tracking-wider text-cream/50 px-4 py-2 rounded-lg border border-cream/15">
              Image unavailable — skip round
            </button>
          </div>
        )}
        {feedback === "correct" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#50C878]/20 backdrop-blur-sm">
            <span className="font-bebas text-4xl text-[#50C878] tracking-widest">{round.answer.toUpperCase()}</span>
          </div>
        )}
        {(feedback === "wrong" || feedback === "close") && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#EF4444]/20 backdrop-blur-sm">
            <span className="font-bebas text-2xl text-[#EF4444] tracking-widest">
              {feedback === "close" ? "SO CLOSE" : "LOCKED OUT"}
            </span>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <input
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitGuess()}
          disabled={locked || !!feedback}
          placeholder="What is this? Guess anytime..."
          className="flex-1 px-4 py-3 rounded-xl bg-cream/[0.04] border border-cream/10 text-cream/90 placeholder-cream/30 focus:border-[#00BFFF]/50 outline-none"
        />
        <button
          onClick={submitGuess}
          disabled={locked || !guess.trim() || !!feedback}
          className="px-6 py-3 rounded-xl font-bebas tracking-wider disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #00BFFF, #0090cc)", color: "#0a0a14" }}
        >
          GUESS
        </button>
      </div>
      <p className="text-cream/35 text-xs mt-2 text-center">Earlier correct guesses score more. One wrong guess locks the round.</p>
    </div>
  );
}

export function Hud({ idx, total, score, oppScore, accent }: { idx: number; total: number; score: number; oppScore: number; accent: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="text-cream/70"><span className="font-bebas text-2xl" style={{ color: accent }}>{score}</span><span className="text-cream/40 text-sm"> you</span></div>
      <div className="font-bebas tracking-wider text-cream/50 text-sm">ROUND {idx + 1} / {total}</div>
      <div className="text-cream/70 text-right"><span className="font-bebas text-2xl text-cream/60">{oppScore}</span><span className="text-cream/40 text-sm"> rival</span></div>
    </div>
  );
}

export function SettlingMsg() {
  return <div className="text-center py-20"><p className="font-bebas text-3xl text-cream/70 tracking-wider">SETTLING...</p></div>;
}
