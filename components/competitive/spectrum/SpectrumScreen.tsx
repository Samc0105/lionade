"use client";

// Spectrum Slider — drag a slider mapped to [min,max] to estimate a value.
// Closest to the true value scores more (distance-based partial credit). Both
// players answer the same prompts. Settles via the shared /complete endpoint.

import { useState, useEffect, useRef, useCallback } from "react";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import { useSettle } from "../useSettle";
import ResultCard from "../ResultCard";
import { Hud, SettlingMsg } from "../zoom/ZoomScreen";
import { scoreSpectrum } from "@/lib/competitive/scoring";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

interface Round {
  id: string;
  round_num: number;
  prompt: string;
  true_value: number;
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
    setRevealed(false); setPct(50); setLastPts(0);
    if (idx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: COMPETITIVE_EVENTS.FINISHED });
      return;
    }
    setIdx((i) => i + 1);
  }, [idx, rounds.length, send]);

  const lockIn = useCallback(() => {
    if (revealed || finished) return;
    const pts = scoreSpectrum({ guess: value, trueValue: round.true_value, min: round.min_value, max: round.max_value });
    setLastPts(pts);
    setScore((s) => { myScoreRef.current = s + pts; return s + pts; });
    setRevealed(true);
    send({ type: COMPETITIVE_EVENTS.PROGRESS, score: myScoreRef.current });
    setTimeout(advance, 1800);
  }, [revealed, finished, value, round, send, advance]);

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

  const truePct = ((round.true_value - round.min_value) / (round.max_value - round.min_value)) * 100;

  return (
    <div>
      <Hud idx={idx} total={rounds.length} score={score} oppScore={oppScore} accent="#A855F7" />
      <div className="rounded-2xl p-6 mb-6" style={{ background: "linear-gradient(135deg, #150a1f 0%, #060c18 100%)", border: "1px solid rgba(168,85,247,0.25)" }}>
        <p className="text-cream/90 text-lg leading-snug text-center mb-8">{round.prompt}</p>

        <div className="relative px-1">
          <input
            type="range" min={0} max={100} step={0.1} value={pct}
            disabled={revealed}
            onChange={(e) => setPct(parseFloat(e.target.value))}
            className="w-full accent-[#A855F7] h-2"
          />
          {/* true marker after reveal */}
          {revealed && (
            <div className="absolute -top-1 h-4 w-0.5 bg-[#50C878]" style={{ left: `${Math.max(0, Math.min(100, truePct))}%` }} />
          )}
        </div>

        <div className="flex justify-between text-cream/40 text-xs mt-1">
          <span>{fmt(round.min_value)}{round.unit ? ` ${round.unit}` : ""}</span>
          <span>{fmt(round.max_value)}{round.unit ? ` ${round.unit}` : ""}</span>
        </div>

        <div className="text-center mt-6">
          <p className="text-cream/40 text-[10px] uppercase tracking-widest">Your estimate</p>
          <p className="font-bebas text-4xl text-[#A855F7]">{fmt(value)}<span className="text-cream/40 text-lg ml-1">{round.unit}</span></p>
          {revealed && (
            <p className="text-[#50C878] text-sm mt-2">
              True value: <span className="font-bebas text-lg">{fmt(round.true_value)} {round.unit}</span> &middot; +{lastPts} pts
            </p>
          )}
        </div>
      </div>

      {!revealed && (
        <button onClick={lockIn} className="w-full font-bebas tracking-wider text-lg py-3 rounded-xl"
          style={{ background: "linear-gradient(135deg, #A855F7, #8b3fd6)", color: "#0a0a14" }}>
          LOCK IN
        </button>
      )}
    </div>
  );
}
