"use client";

// Map Pin Drop — "Drop a pin on X"; haversine distance to the true coordinate
// scores the round (closer = more). Both players answer the same prompts. The
// Leaflet map is dynamically imported (ssr:false) since it needs `window`.

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import type { MatchSettleProps } from "../useSettle";
import Countdown from "../Countdown";
import { SettlingMsg } from "../zoom/ZoomScreen";
import CountUp from "@/components/CountUp";
import { apiPost } from "@/lib/api-client";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

const PinMap = dynamic(() => import("./PinMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full flex items-center justify-center text-cream/40 font-bebas tracking-wider">LOADING MAP...</div>,
});

// true_lat / true_lng are stripped from the in-flight payload by the sanitized
// match route; the true point arrives in the /answer reveal after lock-in.
interface Round {
  id: string;
  round_num: number;
  prompt: string;
}

export default function PinScreen({
  loaded,
  selfId,
  settle,
}: { loaded: LoadedMatch; selfId: string } & Pick<MatchSettleProps, "settle" | "result">) {
  const matchId = loaded.match.id;
  const rounds = loaded.rounds as unknown as Round[];
  const opponentIds = loaded.match.team_a.includes(selfId) ? loaded.match.team_b : loaded.match.team_a;
  const { on, send } = useMatchChannel(matchId, selfId, opponentIds);
  // Settlement is owned by the SHELL (single useSettle hook). This screen only
  // triggers the rounds-exhausted settle; the shell renders the ResultCard.
  const settledRef = useRef(false);

  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [lastDist, setLastDist] = useState(0);
  const [lastPts, setLastPts] = useState(0);
  // True when the /answer POST failed: the round is ungraded, so the km/pts
  // panel would lie ("0 km away" reads as a bullseye). Gates an honest
  // failure card instead.
  const [scoreFailed, setScoreFailed] = useState(false);
  const [truePoint, setTruePoint] = useState<{ lat: number; lng: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [started, setStarted] = useState(false); // false until 3-2-1-GO clears
  const myScoreRef = useRef(0);

  // The post-lock-in round-advance timeout is fire-and-forget; track it so an
  // unmount (navigate away, forfeit, settle) clears any pending advance and
  // can't setState on a dead component.
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anchor the match START (the pre-round 3-2-1-GO) to the server's
  // match.starts_at so both players begin together. Pin has no per-round timer,
  // so the anchor only gates when the first lock-in opens.
  const startsAtRaw = (loaded.match as { starts_at?: string | null }).starts_at ?? null;

  const round = rounds[idx];

  useEffect(() => {
    const off = on(COMPETITIVE_EVENTS.PROGRESS, (p) => {
      if (typeof p.score === "number") setOppScore(p.score as number);
    });
    return () => off();
  }, [on]);

  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
  }, []);

  const advance = useCallback(() => {
    // Guard a stale deferred fire: bail if the match already finished while
    // this advance was queued.
    if (finished) return;
    setGuess(null); setRevealed(false); setLastDist(0); setLastPts(0); setTruePoint(null); setScoreFailed(false);
    if (idx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: COMPETITIVE_EVENTS.FINISHED });
      return;
    }
    setIdx((i) => i + 1);
  }, [idx, rounds.length, send, finished]);

  const lockIn = useCallback(async () => {
    if (!started || revealed || !guess || finished) return;
    setRevealed(true); // lock the map; the server scores by haversine distance
    const { ok, data } = await apiPost<{ points: number; reveal: { true_lat: number; true_lng: number; distance_km: number } }>(
      `/api/competitive/match/${matchId}/answer`,
      { roundNum: round.round_num, lat: guess.lat, lng: guess.lng },
    );
    const pts = ok && data ? data.points : 0;
    const dist = ok && data ? data.reveal.distance_km : 0;
    if (ok && data) setTruePoint({ lat: data.reveal.true_lat, lng: data.reveal.true_lng });
    else setScoreFailed(true);
    setLastDist(dist); setLastPts(pts);
    setScore((s) => { myScoreRef.current = s + pts; return s + pts; });
    send({ type: COMPETITIVE_EVENTS.PROGRESS, score: myScoreRef.current });
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      advance();
    }, 2400);
  }, [started, revealed, guess, finished, round, send, advance, matchId]);

  useEffect(() => {
    if (!finished || settledRef.current) return;
    settledRef.current = true;
    // Outcome is recomputed server-side from competitive_responses; no score map.
    settle();
  }, [finished, settle]);

  // The SHELL renders the lone ResultCard once its hook holds a result; this
  // screen shows only the brief settling interstitial until then.
  if (finished) return <SettlingMsg />;
  if (!round) return <p className="text-cream/60 text-center flex-1 flex items-center justify-center">No rounds loaded.</p>;

  // Map Pin Drop is a MAP game — the map is the screen. It fills the whole play
  // surface edge-to-edge; the prompt, HUD and lock-in control float over it as
  // glassmorphic panels in the corners/edges.
  return (
    <div className="relative flex-1 min-h-0 w-full">
      {/* Pre-round 3-2-1-GO beat (first round only), anchored to the shared
          server starts_at so both players start together. Sits above the map +
          floating panels (the panels are inert until started). */}
      {!started && (
        <div className="absolute inset-0 z-[600]">
          <Countdown accent="#50C878" startsAt={startsAtRaw} onDone={() => setStarted(true)} />
        </div>
      )}

      {/* Full-bleed map */}
      <div className="absolute inset-0">
        <PinMap
          guess={guess}
          truePoint={revealed ? truePoint : null}
          onPick={(lat, lng) => setGuess({ lat, lng })}
          disabled={revealed}
        />
      </div>

      {/* Floating prompt + HUD over the top of the map */}
      <div className="absolute top-3 left-0 right-0 z-[500] px-3 sm:px-6 pointer-events-none">
        <div className="w-full max-w-3xl mx-auto flex flex-col gap-2">
          <div className="rounded-2xl px-5 py-3 text-center backdrop-blur-md pointer-events-none"
            style={{ background: "rgba(8,26,18,0.72)", border: "1px solid rgba(80,200,120,0.3)" }}>
            <p className="text-cream/40 text-[10px] uppercase tracking-widest mb-0.5">Drop a pin on</p>
            <p className="font-bebas text-xl sm:text-2xl tracking-wider text-[#50C878]">{round.prompt}</p>
          </div>
          <div className="flex items-center justify-between rounded-xl px-4 py-1.5 backdrop-blur-md"
            style={{ background: "rgba(6,12,24,0.6)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-cream/70"><span className="font-bebas text-2xl text-[#50C878]"><CountUp value={score} duration={500} /></span><span className="text-cream/40 text-xs"> you</span></div>
            <div className="font-bebas tracking-wider text-cream/50 text-xs">ROUND {idx + 1} / {rounds.length}</div>
            <div className="text-cream/70 text-right"><span className="font-bebas text-2xl text-cream/60"><CountUp value={oppScore} duration={500} /></span><span className="text-cream/40 text-xs"> rival</span></div>
          </div>
        </div>
      </div>

      {/* Floating action / result over the bottom of the map */}
      <div className="absolute bottom-4 left-0 right-0 z-[500] px-3 sm:px-6">
        <div className="w-full max-w-md mx-auto">
          {revealed && scoreFailed ? (
            <div className="ca-pop-in text-center rounded-xl px-4 py-3 backdrop-blur-md"
              style={{ background: "rgba(24,6,8,0.72)", border: "1px solid rgba(239,68,68,0.35)" }}>
              <p className="font-bebas text-lg tracking-wider text-red-300">ROUND DIDN&apos;T SCORE</p>
              <p className="text-cream/50 text-xs mt-0.5">Connection issue. +0 pts this round.</p>
            </div>
          ) : revealed ? (
            <div className="ca-pop-in text-center rounded-xl px-4 py-3 backdrop-blur-md"
              style={{ background: "rgba(6,12,24,0.72)", border: "1px solid rgba(80,200,120,0.3)" }}>
              <p className="text-cream/70">
                <span className="font-bebas text-2xl sm:text-3xl text-[#50C878]">
                  <CountUp value={Math.round(lastDist)} duration={1100} /> km
                </span>
                <span className="text-cream/40 text-sm"> away &middot; +{lastPts} pts</span>
              </p>
            </div>
          ) : (
            <button onClick={lockIn} disabled={!guess} className="w-full font-bebas tracking-wider text-lg py-4 rounded-xl disabled:opacity-50 shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
              style={{ background: "linear-gradient(135deg, #50C878, #3da862)", color: "#0a0a14" }}>
              {guess ? "LOCK IN PIN" : "TAP THE MAP TO PLACE A PIN"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
