"use client";

// Map Pin Drop — "Drop a pin on X"; haversine distance to the true coordinate
// scores the round (closer = more). Both players answer the same prompts. The
// Leaflet map is dynamically imported (ssr:false) since it needs `window`.

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import { useSettle } from "../useSettle";
import ResultCard from "../ResultCard";
import { Hud, SettlingMsg } from "../zoom/ZoomScreen";
import { haversineKm } from "@/lib/competitive/pin-places";
import { scorePin } from "@/lib/competitive/scoring";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

const PinMap = dynamic(() => import("./PinMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full flex items-center justify-center text-cream/40 font-bebas tracking-wider">LOADING MAP...</div>,
});

interface Round {
  id: string;
  round_num: number;
  prompt: string;
  true_lat: number;
  true_lng: number;
}

export default function PinScreen({ loaded, selfId }: { loaded: LoadedMatch; selfId: string }) {
  const matchId = loaded.match.id;
  const rounds = loaded.rounds as unknown as Round[];
  const { on, send } = useMatchChannel(matchId, selfId);
  const { settle, result } = useSettle(matchId);

  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [lastDist, setLastDist] = useState(0);
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

  const advance = useCallback(() => {
    setGuess(null); setRevealed(false); setLastDist(0); setLastPts(0);
    if (idx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: COMPETITIVE_EVENTS.FINISHED });
      return;
    }
    setIdx((i) => i + 1);
  }, [idx, rounds.length, send]);

  const lockIn = useCallback(() => {
    if (revealed || !guess || finished) return;
    const dist = haversineKm(guess.lat, guess.lng, round.true_lat, round.true_lng);
    const pts = scorePin(dist);
    setLastDist(dist); setLastPts(pts);
    setScore((s) => { myScoreRef.current = s + pts; return s + pts; });
    setRevealed(true);
    send({ type: COMPETITIVE_EVENTS.PROGRESS, score: myScoreRef.current });
    setTimeout(advance, 2400);
  }, [revealed, guess, finished, round, send, advance]);

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
      <Hud idx={idx} total={rounds.length} score={score} oppScore={oppScore} accent="#50C878" />
      <div className="rounded-2xl px-5 py-4 mb-4 text-center" style={{ background: "linear-gradient(135deg, #081a12 0%, #060c18 100%)", border: "1px solid rgba(80,200,120,0.25)" }}>
        <p className="text-cream/40 text-[10px] uppercase tracking-widest mb-1">Drop a pin on</p>
        <p className="font-bebas text-2xl tracking-wider text-[#50C878]">{round.prompt}</p>
      </div>

      <div className="rounded-2xl overflow-hidden mb-4 h-[360px]" style={{ border: "1px solid rgba(80,200,120,0.2)" }}>
        <PinMap
          guess={guess}
          truePoint={revealed ? { lat: round.true_lat, lng: round.true_lng } : null}
          onPick={(lat, lng) => setGuess({ lat, lng })}
          disabled={revealed}
        />
      </div>

      {revealed ? (
        <div className="text-center">
          <p className="text-cream/70">
            <span className="font-bebas text-2xl text-[#50C878]">{Math.round(lastDist).toLocaleString()} km</span>
            <span className="text-cream/40 text-sm"> away &middot; +{lastPts} pts</span>
          </p>
        </div>
      ) : (
        <button onClick={lockIn} disabled={!guess} className="w-full font-bebas tracking-wider text-lg py-3 rounded-xl disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #50C878, #3da862)", color: "#0a0a14" }}>
          {guess ? "LOCK IN PIN" : "TAP THE MAP TO PLACE A PIN"}
        </button>
      )}
    </div>
  );
}
