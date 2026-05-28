"use client";

// Spectrum Slider — drag a slider mapped to [min,max] to estimate a value.
// Closest to the true value scores more (distance-based partial credit). Both
// players answer the same prompts. Settles via the shared /complete endpoint.

import { useState, useEffect, useRef, useCallback } from "react";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import { useSettle } from "../useSettle";
import ResultCard from "../ResultCard";
import { Hud, SettlingMsg } from "../zoom/ZoomScreen";
import { apiPost } from "@/lib/api-client";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

// true_value is stripped from the in-flight payload by the sanitized match route
// and only arrives in the /answer reveal after the player locks in.
interface Round {
  id: string;
  round_num: number;
  prompt: string;
  min_value: number;
  max_value: number;
  unit: string | null;
}

function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function SpectrumScreen({ loaded, selfId }: { loaded: LoadedMatch; selfId: string }) {
  const matchId = loaded.match.id;
  const rounds = loaded.rounds as unknown as Round[];
  const { on, send } = useMatchChannel(matchId, selfId);
  const { settle, result } = useSettle(matchId);

  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [pct, setPct] = useState(50);
  const [revealed, setRevealed] = useState(false);
  const [lastPts, setLastPts] = useState(0);
  const [trueValue, setTrueValue] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const myScoreRef = useRef(0);

  const round = rounds[idx];

  useEffect(() => {
    const off = on(COMPETITIVE_EVENTS.PROGRESS, (p) => {
      if (typeof p.score === "number") setOppScore(p.score as number);
    });
    return () => off();
  }, [on]);

  const value = round ? round.min_value + (pct / 100) * (round.max_value - round.min_value) : 0;

  const advance = useCallback(() => {
    setRevealed(false); setPct(50); setLastPts(0); setTrueValue(null);
    if (idx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: COMPETITIVE_EVENTS.FINISHED });
      return;
    }
    setIdx((i) => i + 1);
  }, [idx, rounds.length, send]);

  const lockIn = useCallback(async () => {
    if (revealed || finished) return;
    setRevealed(true); // lock the slider immediately; the server scores the guess
    const { ok, data } = await apiPost<{ points: number; reveal: { true_value: number } }>(
      `/api/competitive/match/${matchId}/answer`,
      { roundNum: round.round_num, guess: value },
    );
    const pts = ok && data ? data.points : 0;
    if (ok && data) setTrueValue(data.reveal.true_value);
    setLastPts(pts);
    setScore((s) => { myScoreRef.current = s + pts; return s + pts; });
    send({ type: COMPETITIVE_EVENTS.PROGRESS, score: myScoreRef.current });
    setTimeout(advance, 1800);
  }, [revealed, finished, value, round, send, advance, matchId]);

  useEffect(() => {
    if (!finished) return;
    // Outcome is recomputed server-side from competitive_responses; no score map.
    settle();
  }, [finished, settle]);

  if (result) return <ResultCard result={result} selfId={selfId} teamA={loaded.match.team_a} />;
  if (finished) return <SettlingMsg />;
  if (!round) return <p className="text-cream/60 text-center flex-1 flex items-center justify-center">No rounds loaded.</p>;

  const truePct =
    trueValue === null
      ? 0
      : ((trueValue - round.min_value) / (round.max_value - round.min_value)) * 100;

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full px-3 sm:px-6">
      <Hud idx={idx} total={rounds.length} score={score} oppScore={oppScore} accent="#A855F7" />

      {/* Prompt + slider command the center mass */}
      <div className="flex-1 min-h-0 flex flex-col justify-center w-full max-w-3xl mx-auto py-4">
        <p className="text-cream/90 text-2xl sm:text-3xl lg:text-4xl leading-snug text-center mb-10 sm:mb-14 font-medium">{round.prompt}</p>

        <div className="relative px-1">
          <input
            type="range" min={0} max={100} step={0.1} value={pct}
            disabled={revealed}
            aria-label="Estimate slider"
            onChange={(e) => setPct(parseFloat(e.target.value))}
            className="w-full accent-[#A855F7] h-3"
          />
          {/* true marker after reveal */}
          {revealed && trueValue !== null && (
            <div className="absolute -top-1 h-5 w-0.5 bg-[#50C878]" style={{ left: `${Math.max(0, Math.min(100, truePct))}%` }} />
          )}
        </div>

        <div className="flex justify-between text-cream/40 text-xs sm:text-sm mt-1.5">
          <span>{fmt(round.min_value)}{round.unit ? ` ${round.unit}` : ""}</span>
          <span>{fmt(round.max_value)}{round.unit ? ` ${round.unit}` : ""}</span>
        </div>

        <div className="text-center mt-8 sm:mt-10">
          <p className="text-cream/40 text-[10px] uppercase tracking-widest">Your estimate</p>
          <p className="font-bebas text-5xl sm:text-7xl text-[#A855F7]">{fmt(value)}<span className="text-cream/40 text-xl sm:text-2xl ml-1.5">{round.unit}</span></p>
          {revealed && trueValue !== null && (
            <p className="text-[#50C878] text-sm sm:text-base mt-3">
              True value: <span className="font-bebas text-lg sm:text-xl">{fmt(trueValue)} {round.unit}</span> &middot; +{lastPts} pts
            </p>
          )}
        </div>
      </div>

      {/* LOCK IN pinned to the bottom edge */}
      <div className="flex-none w-full max-w-2xl mx-auto pb-1">
        {!revealed && (
          <button onClick={lockIn} className="w-full font-bebas tracking-wider text-xl py-4 rounded-xl"
            style={{ background: "linear-gradient(135deg, #A855F7, #8b3fd6)", color: "#0a0a14" }}>
            LOCK IN
          </button>
        )}
      </div>
    </div>
  );
}
